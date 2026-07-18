import { execFile } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
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
// needs to find its stored login. Nothing ANTHROPIC_* passes through — the
// metered API key is excluded BY CONSTRUCTION so auth resolves to the
// subscription login (ADR-0044 decision 3) — and CLAUDE_CODE_OAUTH_TOKEN is
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

// model and effort ride the command line, and both are config-authorable —
// on a fork PR, attacker-authorable. A strict charset keeps the argv free of
// anything a shell could interpret; a value outside it is refused loudly,
// never quoted into a command.
const SAFE_ARG_RE = /^[A-Za-z0-9._:-]+$/;

export interface ClaudeCodeTransportOptions {
  /** The owned deadline (ADR-0044 decision 2), seconds. Comes from config; never a constant in check code. */
  deadlineSeconds: number;
  /** The environment the allowlist filters. Injectable for the deterministic fake-CLI harness. */
  env?: NodeJS.ProcessEnv;
}

/** Defensive reads off the canonical request object; the transport realizes the request over the CLI and refuses shapes it cannot realize. */
function requestField(request: object, path: string[], label: string): string {
  let cursor: unknown = request;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) cursor = undefined;
    else cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor !== "string" || cursor === "") {
    throw new Tier1TransportError("transport", `request carries no ${label} — cannot realize the call`);
  }
  return cursor;
}

/**
 * The live claude-code backend (ADR-0044): spawns the claude CLI per the PR B
 * canonical invocation — json output, pinned model, effort passthrough,
 * --no-session-persistence, --strict-mcp-config — under a hermetic env
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
            `${label} ${JSON.stringify(value)} is outside the command-line-safe charset — refused, never quoted into a shell`
          );
        }
      }
      const prompt = requestField(request, ["messages", "0", "content"], "user message content");

      const spawnEnv: NodeJS.ProcessEnv = {};
      for (const key of CLAUDE_CODE_ENV_ALLOWLIST) {
        if (sourceEnv[key] !== undefined) spawnEnv[key] = sourceEnv[key];
      }
      spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

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
      ];

      const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number | string }>(
        (resolvePromise, rejectPromise) => {
          const child = execFile(
            "claude",
            args,
            {
              env: spawnEnv,
              // The claude shim needs a shell to resolve cross-platform; the
              // argv is fixed tokens only (see SAFE_ARG_RE above), so the
              // measured Windows concatenation hazard has nothing to swallow.
              shell: true,
              maxBuffer: 64 * 1024 * 1024,
            },
            (error, out) => {
              if (error !== null && out.length === 0 && error.code === "ENOENT") {
                rejectPromise(
                  new Tier1TransportError("transport", "spawn failure: the claude CLI is not on PATH")
                );
                return;
              }
              resolvePromise({ stdout: String(out), exitCode: error === null ? 0 : (error.code ?? 1) });
            }
          );
          child.stdin?.end(prompt);
        }
      );

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
          throw new Tier1TransportError("quota", `api_error_status 429 — ${detail}`);
        }
        throw new Tier1TransportError("auth", `api_error_status ${String(status)} — ${detail}`);
      }

      return { response: envelope, usage: USAGE_EXTRACTORS["claude-code"](envelope) };
    },
  };
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
