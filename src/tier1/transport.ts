import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Tier1Config } from "../config/load.js";
import { claudeCodeCredentialsPresent, tier1CredentialsPresent } from "./credentials.js";
import { loadRecording, replayOrFail } from "./recording.js";
import type { RecordingBackend } from "./recording.js";

// One transport interface, two implementations (ADR-0031): live for the real
// API, replay for the recorded-response doctrine of ADR-0028. CI uses only
// replay — a prompt change fails CI with the stale-recording error naming the
// check, exactly as designed. The runner cannot tell them apart, which is the
// point: the tested pipeline and the production pipeline are the same code.
//
// The seam carries exactly two things out (ADR-0044): the verbatim response
// body and its usage block. Usage is extracted HERE, per backend, so no caller
// ever learns a backend's envelope shape: a conditional on backend anywhere
// outside this module is the rejected pattern the contract names.

export interface Tier1TransportResult {
  /** The verbatim response body: a Messages API message (api) or the headless result envelope (claude-code). */
  response: unknown;
  /** The response's own usage block, extracted at the seam; null when the body carries none. */
  usage: unknown;
}

export interface Tier1Transport {
  /** Assembled prompt in; raw response plus usage out. Nothing else crosses the seam (ADR-0044). */
  send(request: object): Promise<Tier1TransportResult>;
}

// Both backends happen to carry usage at the top level of their envelope
// today (the Messages API message and the PR B-measured headless result
// alike), but each backend names its own extractor so a future envelope
// change stays a transport-module edit, never a caller edit.
const USAGE_EXTRACTORS: Record<RecordingBackend, (response: unknown) => unknown> = {
  api: topLevelUsage,
  "claude-code": topLevelUsage,
};

function topLevelUsage(response: unknown): unknown {
  return typeof response === "object" && response !== null
    ? ((response as Record<string, unknown>).usage ?? null)
    : null;
}

/**
 * The real Messages API via the official SDK. The key is read from the
 * environment INSIDE send, at send time — its value never appears in any
 * object the runner, the prompt builder, or the report can see (ADR-0029's
 * quarantine, extended to the transport boundary).
 */
export function liveTransport(env: NodeJS.ProcessEnv = process.env): Tier1Transport {
  return {
    async send(request: object): Promise<Tier1TransportResult> {
      const key = env.ANTHROPIC_API_KEY;
      if (key === undefined || key.trim() === "") {
        throw new Error(
          "liveTransport: ANTHROPIC_API_KEY is not present in the environment — Tier 1 cannot send"
        );
      }
      const client = new Anthropic({ apiKey: key });
      // The request object is the canonical, already-hashed request
      // (ADR-0028) — pass it through unmodified.
      const response = await client.messages.create(
        request as Parameters<typeof client.messages.create>[0]
      );
      return { response, usage: USAGE_EXTRACTORS.api(response) };
    },
  };
}

/**
 * The transport's own failure vocabulary (ADR-0044 decision 5): every error
 * leaving a transport names its class, and no class is ever silent. "auth" is
 * the measured 401 family (envelope api_error_status, cost 0); "quota" is the
 * documented 429 family, documented-not-observed until M5.3 sees one live;
 * "transport" is everything mechanical: deadline kill, spawn failure,
 * malformed envelope, model-verification refusal.
 */
export class Tier1TransportError extends Error {
  constructor(
    readonly kind: "auth" | "quota" | "transport",
    message: string
  ) {
    super(`claude-code transport [${kind}]: ${message}`);
    this.name = "Tier1TransportError";
  }
}

// The hermetic spawn allowlist, measured in the PR B spike: PATH plus the
// Windows system variables node needs, plus the profile directories the CLI
// needs to find its stored login. Nothing ANTHROPIC_* passes through: the
// metered API key is excluded BY CONSTRUCTION so auth resolves to the
// subscription login (ADR-0044 decision 3), and CLAUDE_CODE_OAUTH_TOKEN is
// added back explicitly, read at send time (the ADR-0029 quarantine extended).
const CLAUDE_CODE_ENV_ALLOWLIST = [
  "PATH",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "USERNAME",
] as const;

// model and effort ride the command line, and both are config-authorable:
// on a fork PR, attacker-authorable. A strict charset keeps the argv free of
// anything a shell could interpret; a value outside it is refused loudly,
// never quoted into a command.
const SAFE_ARG_RE = /^[A-Za-z0-9._:-]+$/;

export interface ClaudeCodeTransportOptions {
  /** The owned deadline (ADR-0044 decision 2), seconds. Comes from config; never a constant in check code. */
  deadlineSeconds: number;
  /** The scanned repo's root: the scratch dir is asserted OUTSIDE it (ADR-0048), so a repo-set temp env can never host the hermetic scratch. */
  repoRoot: string;
  /** The environment the allowlist filters. Injectable for the deterministic fake-CLI harness. */
  env?: NodeJS.ProcessEnv;
  /** The claude binary, injected. The ONE seam a test provides a binary through (ADR-0048); production resolves the trusted path from the tool's own install and never consults PATH. */
  claudeBinaryPath?: string;
}

/** Defensive reads off the canonical request object; the transport realizes the request over the CLI and refuses shapes it cannot realize. */
function requestField(request: object, path: string[], label: string): string {
  let cursor: unknown = request;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) cursor = undefined;
    else cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor !== "string" || cursor === "") {
    throw new Tier1TransportError("transport", `request carries no ${label}; cannot realize the call`);
  }
  return cursor;
}

/** The request's system blocks, joined: our own static doctrine and check instructions, never repo bytes (those ride the user message). Carried via --system-prompt-file, REPLACING the CLI's default system prompt so the call's context is exactly the api backend's. */
function systemTextOf(request: object): string {
  const system = (request as Record<string, unknown>).system;
  if (!Array.isArray(system) || system.length === 0) {
    throw new Tier1TransportError("transport", "request carries no system blocks; cannot realize the call");
  }
  const texts = system.map((block) =>
    typeof block === "object" && block !== null ? (block as Record<string, unknown>).text : undefined
  );
  if (texts.some((t) => typeof t !== "string")) {
    throw new Tier1TransportError("transport", "a system block carries no text; cannot realize the call");
  }
  return (texts as string[]).join("\n\n");
}

/** The forced report_findings tool's input schema, realized as --json-schema: the CLI validates the structured output against it, the headless equivalent of the api backend's forced tool call (measured, PR D probe). */
function findingsSchemaOf(request: object): string {
  const tools = (request as Record<string, unknown>).tools;
  const tool = Array.isArray(tools)
    ? tools.find(
        (t) => typeof t === "object" && t !== null && (t as Record<string, unknown>).name === "report_findings"
      )
    : undefined;
  const schema = tool !== undefined ? (tool as Record<string, unknown>).input_schema : undefined;
  if (typeof schema !== "object" || schema === null) {
    throw new Tier1TransportError(
      "transport",
      "request carries no report_findings tool schema; cannot realize the forced call"
    );
  }
  return JSON.stringify(schema);
}

interface ResolvedClaudeSpawn {
  file: string;
  argsPrefix: string[];
  /** True only for the Windows .cmd/.bat harness shim, where args transit a shell. Real runs (native exe, POSIX shebang) never take it: payload argv would be mangled. */
  shell: boolean;
}

const toolRequire = createRequire(import.meta.url);

/**
 * The trusted claude binary (ADR-0048): resolved from duckadrift's OWN install,
 * the one location the scanned repo's bytes cannot write, NEVER from PATH. The
 * scanned repo can prepend a directory to PATH, so a PATH lookup would resolve a
 * planted fake; this resolution ignores PATH entirely. If the binary is not in
 * the trusted install, the run refuses loudly: there is no PATH fall-through.
 *
 * NOTE (provisioning follow-up, ADR-0048): @anthropic-ai/claude-code is not yet a
 * duckadrift dependency, so in a stock install this refuses and the subscription
 * backend is inert until claude-code is provisioned into the tool's install.
 */
function resolveTrustedClaudeBinary(): string {
  let packageJson: string;
  try {
    packageJson = toolRequire.resolve("@anthropic-ai/claude-code/package.json");
  } catch {
    throw new Tier1TransportError(
      "transport",
      "the claude-code CLI is not resolvable from duckadrift's own install; the subscription backend resolves its binary only from the tool's trusted node_modules, never from PATH (ADR-0048). Refused."
    );
  }
  // The native launcher under the package, mirroring ADR-0044's Windows
  // derivation (bin/claude.exe) and its POSIX analog (bin/claude).
  const bin = join(dirname(packageJson), "bin", process.platform === "win32" ? "claude.exe" : "claude");
  if (!existsSync(bin)) {
    throw new Tier1TransportError(
      "transport",
      `the claude-code binary was not found at the trusted location ${JSON.stringify(bin)}; refused, never resolved through PATH (ADR-0048)`
    );
  }
  return bin;
}

/**
 * Maps a resolved absolute binary path to a spawn descriptor. A .cmd/.bat on
 * Windows must transit a shell (the fake harness shim); a native exe or a POSIX
 * shebang script spawns shell-free, so payload argv arrives pristine.
 */
function spawnDescriptorFor(binaryPath: string): ResolvedClaudeSpawn {
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(binaryPath);
  return { file: binaryPath, argsPrefix: [], shell };
}

/**
 * The live claude-code backend (ADR-0044): spawns the claude CLI per the PR B
 * canonical invocation (json output, pinned model, effort passthrough,
 * --no-session-persistence, --strict-mcp-config) under a hermetic env
 * allowlist. One deliberate deviation from the spike's shape, stated in the
 * M5.1 ledger: the prompt travels via STDIN, not a positional arg, because
 * document content is untrusted repo bytes and no quoting discipline makes
 * arbitrary text safe on a cmd.exe command line (percent-expansion survives
 * quotes). The argv carries only fixed tokens and charset-validated config
 * values.
 */
export function claudeCodeTransport(opts: ClaudeCodeTransportOptions): Tier1Transport {
  const sourceEnv = opts.env ?? process.env;
  return {
    async send(request: object): Promise<Tier1TransportResult> {
      const token = sourceEnv.CLAUDE_CODE_OAUTH_TOKEN;
      if (token === undefined || token.trim() === "") {
        throw new Tier1TransportError(
          "auth",
          "CLAUDE_CODE_OAUTH_TOKEN is not present in the environment — Tier 1 cannot send"
        );
      }
      const model = requestField(request, ["model"], "model");
      const effort = requestField(request, ["output_config", "effort"], "output_config.effort");
      for (const [label, value] of [["model", model], ["effort", effort]] as const) {
        if (!SAFE_ARG_RE.test(value)) {
          throw new Tier1TransportError(
            "transport",
            `${label} ${JSON.stringify(value)} is outside the command-line-safe charset; refused, never quoted into a shell`
          );
        }
      }
      const prompt = requestField(request, ["messages", "0", "content"], "user message content");
      const systemText = systemTextOf(request);
      const schemaJson = findingsSchemaOf(request);

      const spawnEnv: NodeJS.ProcessEnv = {};
      for (const key of CLAUDE_CODE_ENV_ALLOWLIST) {
        if (sourceEnv[key] !== undefined) spawnEnv[key] = sourceEnv[key];
      }
      spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

      // The trusted binary (ADR-0048): the injected test path, or resolved from
      // the tool's own install; never PATH. Resolved before any resource so a
      // refusal leaks nothing.
      const resolved = spawnDescriptorFor(opts.claudeBinaryPath ?? resolveTrustedClaudeBinary());

      // Per-send scratch: the system prompt rides a FILE (argv-size and
      // quoting safe), and the scratch dir is the child's cwd, so the CLI's
      // CLAUDE.md auto-discovery finds nothing and the call's context is
      // exactly the request (hermeticity, ADR-0044 decision 3; the scanned
      // repo's own CLAUDE.md must never bleed into a check prompt).
      //
      // The scratch is anchored OUTSIDE the scanned repo (ADR-0048): tmpdir()
      // honors TMPDIR/TEMP/TMP, which the scanned repo can set, so a redirect
      // that would place the scratch under repoRoot is refused loudly rather
      // than proceeded with, isolation defeated.
      const tmpBase = resolve(tmpdir());
      const repoRootAbs = resolve(opts.repoRoot);
      const relToRepo = relative(repoRootAbs, tmpBase);
      if (relToRepo === "" || (!relToRepo.startsWith("..") && !isAbsolute(relToRepo))) {
        throw new Tier1TransportError(
          "transport",
          `the resolved temp base ${JSON.stringify(tmpBase)} is inside the scanned repo ${JSON.stringify(repoRootAbs)}; refused, the scanned repo cannot host the hermetic scratch (ADR-0048)`
        );
      }
      const scratch = mkdtempSync(join(tmpBase, "duckadrift-claude-code-"));
      const systemFile = join(scratch, "system-prompt.txt");
      writeFileSync(systemFile, systemText, "utf-8");

      const args = [
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--effort",
        effort,
        "--no-session-persistence",
        "--strict-mcp-config",
        "--tools",
        "",
        "--system-prompt-file",
        systemFile,
        "--json-schema",
        schemaJson,
      ];

      const deadlineMs = opts.deadlineSeconds * 1000;
      let stdout: string;
      let exitCode: number | string;
      try {
        ({ stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number | string }>(
        (resolvePromise, rejectPromise) => {
          let settled = false;
          const child = execFile(
            resolved.file,
            [...resolved.argsPrefix, ...args],
            {
              env: spawnEnv,
              cwd: scratch,
              // Real runs spawn shell-free with pristine argv (the native
              // binary from the trusted install, or a POSIX shebang script);
              // only the Windows .cmd harness shim transits a shell, and the
              // fakes ignore argv (spawnDescriptorFor above, ADR-0048).
              shell: resolved.shell,
              maxBuffer: 64 * 1024 * 1024,
            },
            (error, out) => {
              if (settled) return; // the deadline already rejected; this is the kill's echo
              settled = true;
              clearTimeout(deadline);
              if (error !== null && out.length === 0 && error.code === "ENOENT") {
                rejectPromise(
                  new Tier1TransportError("transport", "spawn failure: the resolved claude binary could not be spawned")
                );
                return;
              }
              resolvePromise({ stdout: String(out), exitCode: error === null ? 0 : (error.code ?? 1) });
            }
          );
          // The owned deadline (ADR-0044 decision 2): the CLI is proven never
          // to self-terminate under transport denial, so waiting on it is a
          // dormancy violation. On expiry the whole process tree dies (the
          // shell shim spawns the real CLI as a child; killing only the shim
          // would leave the CLI running) and a terminal transport error
          // surfaces naming the deadline.
          const deadline = setTimeout(() => {
            if (settled) return;
            settled = true;
            if (process.platform === "win32" && child.pid !== undefined) {
              spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true });
            } else {
              child.kill("SIGKILL");
            }
            rejectPromise(
              new Tier1TransportError(
                "transport",
                `deadline of ${opts.deadlineSeconds}s expired; killed the process tree (the CLI does not self-terminate under transport denial, measured in PR B)`
              )
            );
          }, deadlineMs);
          // A child that dies before draining stdin (spawn failure, the
          // deadline kill) EPIPEs the pending prompt write. The exec callback
          // and the deadline path already own that outcome; the write error is
          // their echo, not a new event, so the handler is a no-op BY DESIGN.
          // Without it the echo is an unhandled stream error that can crash
          // the host process mid-check (PR #54 verifier finding, 3/3 Linux).
          child.stdin?.on("error", () => {});
          child.stdin?.end(prompt);
        }
      ));
      } finally {
        // The per-send scratch (system-prompt file, hermetic cwd) is
        // disposable; a kill can hold the dir briefly, so failure to remove
        // is swallowed rather than masking the call's own outcome.
        try {
          rmSync(scratch, { recursive: true, force: true });
        } catch {
          // best-effort cleanup only
        }
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        throw new Tier1TransportError(
          "transport",
          `malformed envelope: stdout is not JSON (exit ${exitCode}, ${stdout.length} bytes)`
        );
      }
      if (typeof envelope !== "object" || envelope === null || (envelope as Record<string, unknown>).type !== "result") {
        throw new Tier1TransportError(
          "transport",
          `malformed envelope: not a headless result object (exit ${exitCode})`
        );
      }
      const body = envelope as Record<string, unknown>;

      if (body.is_error === true || (typeof body.api_error_status === "number" && body.api_error_status !== null)) {
        const status = body.api_error_status;
        const detail = typeof body.result === "string" ? body.result : "no error text in envelope";
        if (status === 429) {
          // The documented 429 family (quota-documented.md): shape upgraded
          // from documented-not-observed the day M5.3 sees one live.
          throw new Tier1TransportError("quota", `api_error_status 429: ${detail}`);
        }
        throw new Tier1TransportError("auth", `api_error_status ${String(status)}: ${detail}`);
      }

      // Model pinning is verified, not trusted (ADR-0044 decision 4): the
      // envelope's modelUsage names the model that actually ran (measured,
      // PR B), and anything but exactly the pinned model is refused loudly.
      const modelUsage = body.modelUsage;
      const ranModels =
        typeof modelUsage === "object" && modelUsage !== null ? Object.keys(modelUsage) : [];
      if (ranModels.length !== 1 || ranModels[0] !== model) {
        throw new Tier1TransportError(
          "transport",
          `model verification failed: pinned ${model}, envelope names ${
            ranModels.length === 0 ? "no model" : ranModels.join(", ")
          } (refused, ADR-0044 decision 4)`
        );
      }

      // Extraction (PR D): the CLI's schema-validated structured_output IS
      // the forced report_findings call's input (measured: the probe's
      // envelope carries it as a dedicated field). The transport maps it into
      // the canonical response shape the api backend produces, so the runner
      // and the citation validator see the same shapes and no caller changes.
      const structured = body.structured_output;
      if (typeof structured !== "object" || structured === null) {
        throw new Tier1TransportError(
          "transport",
          "malformed envelope: no structured_output despite a success result; the forced call did not land"
        );
      }
      const response = {
        content: [
          {
            type: "tool_use",
            id: "toolu_claude_code_structured_output",
            name: "report_findings",
            input: structured,
          },
        ],
        usage: body.usage ?? null,
        // The VERIFIED model echo, retained as raw bytes (PR D verifier
        // directive): a recording's model-key claim rests on byte evidence in
        // the artifact, not on transitive gate passage. The api response
        // carries its own `model` echo; this is the headless equivalent.
        modelUsage: body.modelUsage,
      };
      return { response, usage: USAGE_EXTRACTORS["claude-code"](response) };
    },
  };
}

// The backend-keyed credential map (ADR-0044 decision 1): the primitives in
// credentials.ts know only env-var presence; WHICH backend needs WHICH
// credential is decided here and nowhere else.
const CREDENTIALS_PRESENT: Record<RecordingBackend, (env: NodeJS.ProcessEnv) => boolean> = {
  api: tier1CredentialsPresent,
  "claude-code": claudeCodeCredentialsPresent,
};

/** True when the configured backend's credential is present. The one credential question callers may ask. */
export function backendCredentialsPresent(
  backend: RecordingBackend,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return CREDENTIALS_PRESENT[backend](env);
}

// The credential's NAME per backend, for loud skip copy (PDR 2.8: partial
// blindness is permitted, unannounced blindness is not). Names only; a value
// never leaves process.env.
const CREDENTIAL_NAMES: Record<RecordingBackend, string> = {
  api: "ANTHROPIC_API_KEY",
  "claude-code": "CLAUDE_CODE_OAUTH_TOKEN",
};

/** The env-var name the configured backend's credential lives in, so a skip line can say exactly what is missing. */
export function backendCredentialName(backend: RecordingBackend): string {
  return CREDENTIAL_NAMES[backend];
}

/**
 * The live transport for the configured backend (ADR-0044 decision 1): the
 * ONE place the backend picks an implementation. Callers hold a
 * Tier1Transport and never learn which.
 */
export function liveTransportFor(
  config: Tier1Config,
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env
): Tier1Transport {
  return config.backend === "claude-code"
    ? claudeCodeTransport({ deadlineSeconds: config.deadline_seconds, repoRoot, env })
    : liveTransport(env);
}

/**
 * Replay from a committed recording — refusal-first (ADR-0028): a request
 * whose canonical hash disagrees with the recording throws the stale error
 * naming the check; a stale recording is never silently replayed.
 */
export function replayTransport(recordingPath: string): Tier1Transport {
  return {
    async send(request: object): Promise<Tier1TransportResult> {
      const response = replayOrFail(request, recordingPath);
      // The recording's own key names the backend whose envelope this is;
      // the replay extracts usage exactly as that backend's live transport
      // would, so replay and live stay the same pipeline (ADR-0028).
      const backend = loadRecording(recordingPath).key.backend;
      return { response, usage: USAGE_EXTRACTORS[backend](response) };
    },
  };
}
