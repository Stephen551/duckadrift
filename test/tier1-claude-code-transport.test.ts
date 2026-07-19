import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Tier1TransportError, claudeCodeTransport, killProcessTree, resolveTrustedClaudeBinary } from "../src/tier1/transport.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The live claude-code transport, proven deterministically (ADR-0044): a fake
// claude CLI per scenario replays PR B's committed captures verbatim against the
// REAL spawn path. Zero credentials, zero network, zero live calls.
//
// ADR-0048: the transport resolves its binary only from a trusted location,
// never PATH. So every test here provides its fake through the ONE injectable
// seam (claudeBinaryPath): none resolves through PATH. A test that still passed
// through PATH resolution would be a false green, so there is none. Two guards
// close the resolution itself: a fake planted on PATH never runs (promoted red
// 3), and with nothing injected the production resolution refuses loudly rather
// than fall through to PATH.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_ROOT = join(__dirname, "fixtures", "claude-code-fake");
const PATH_SENTINEL = "PATH_HIJACK_SENTINEL_8f2a1c"; // baked into the path-hijack fake's envelope

// A throwaway repoRoot for the taxonomy tests. os.tmpdir() is its parent, so the
// scratch (anchored under os.tmpdir()) always resolves outside it (ADR-0048).
const REPO_ROOT = mkdtempSync(join(tmpdir(), "duckadrift-transport-repo-"));
afterAll(() => rmSync(REPO_ROOT, { recursive: true, force: true }));

/** The fake CLI for a scenario, INJECTED as the trusted binary. Windows spawns the .cmd shim (shell); POSIX the shebang script. */
function fakeBinary(scenario: string): string {
  return join(FAKE_ROOT, scenario, process.platform === "win32" ? "claude.cmd" : "claude");
}

/** Base env: a real PATH so the fake's own `node` resolves, no api key, a shaped token the fake never reads. PATH is never used to resolve claude (ADR-0048). */
function harnessEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test-harness-token-never-real" };
}

/** Transport opts for a scenario: the injected fake binary, a repoRoot os.tmpdir() sits outside, the owned deadline. */
function baseOpts(scenario: string): { deadlineSeconds: number; repoRoot: string; env: NodeJS.ProcessEnv; claudeBinaryPath: string } {
  return { deadlineSeconds: 60, repoRoot: REPO_ROOT, env: harnessEnv(), claudeBinaryPath: fakeBinary(scenario) };
}

function request(model = "claude-sonnet-5"): object {
  // The realized surface (PR D): system blocks ride --system-prompt-file, the
  // forced tool's schema rides --json-schema, the user message rides stdin. The
  // fakes ignore argv; the REQUEST must still carry all three or the transport
  // refuses to realize it.
  return {
    model,
    max_tokens: 1024,
    output_config: { effort: "high" },
    system: [{ type: "text", text: "You are the harness probe." }],
    tools: [{ name: "report_findings", input_schema: { type: "object", properties: { findings: { type: "array" } }, required: ["findings"] } }],
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  };
}

async function errorFrom(promise: Promise<unknown>): Promise<Tier1TransportError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(Tier1TransportError);
    return err as Tier1TransportError;
  }
  throw new Error("expected the transport to throw, and it returned");
}

describe("claude-code transport: the taxonomy against the real spawn path (ADR-0044), binary injected (ADR-0048)", () => {
  it("canonical envelope: extraction maps structured_output into the api-canonical tool call, usage intact", async () => {
    const transport = claudeCodeTransport(baseOpts("canonical"));
    const result = await transport.send(request());
    const response = result.response as { content: Array<Record<string, unknown>>; usage: Record<string, unknown> };
    expect(response.content).toHaveLength(1);
    expect(response.content[0]!.type).toBe("tool_use");
    expect(response.content[0]!.name).toBe("report_findings");
    expect(response.content[0]!.input).toEqual({ findings: [] });
    const usage = result.usage as Record<string, unknown>;
    expect(usage.input_tokens).toBe(2);
    expect(usage.output_tokens).toBe(65);
    const modelUsage = (result.response as Record<string, unknown>).modelUsage as Record<string, unknown>;
    expect(Object.keys(modelUsage)).toEqual(["claude-sonnet-5"]);
  });

  it("auth: the measured 401 envelope surfaces as a distinct auth-class error", async () => {
    const err = await errorFrom(claudeCodeTransport(baseOpts("auth-401")).send(request()));
    expect(err.kind).toBe("auth");
    expect(err.message).toContain("401");
  });

  it("quota: the documented 429 family surfaces as a distinct quota-class error (documented-not-observed)", async () => {
    const err = await errorFrom(claudeCodeTransport(baseOpts("quota-429")).send(request()));
    expect(err.kind).toBe("quota");
    expect(err.message).toContain("429");
  });

  it("malformed envelope: non-JSON stdout surfaces as a transport-class error", async () => {
    const err = await errorFrom(claudeCodeTransport(baseOpts("malformed")).send(request()));
    expect(err.kind).toBe("transport");
    expect(err.message).toContain("malformed envelope");
  });

  it("spawn failure: an injected binary that does not exist surfaces as a transport-class error", async () => {
    const transport = claudeCodeTransport({ ...baseOpts("canonical"), claudeBinaryPath: fakeBinary("no-such-fake-dir") });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("transport");
  });

  it("credential absence inside send is a loud auth-class error, never a silent skip", async () => {
    const env = harnessEnv();
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    const transport = claudeCodeTransport({ ...baseOpts("canonical"), env });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("auth");
    expect(err.message).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("a config value outside the command-line-safe charset is refused, never quoted into a shell", async () => {
    const transport = claudeCodeTransport(baseOpts("canonical"));
    const err = await errorFrom(transport.send(request('claude-sonnet-5"; rm -rf .')));
    expect(err.kind).toBe("transport");
    expect(err.message).toContain("charset");
  });

  it("model verification: an envelope whose modelUsage names a different model is refused (ADR-0044 decision 4)", async () => {
    const err = await errorFrom(claudeCodeTransport(baseOpts("wrong-model")).send(request()));
    expect(err.kind).toBe("transport");
    expect(err.message).toContain("model");
  });

  it(
    "the owned deadline: a CLI that never terminates is killed and surfaces a terminal transport error naming the deadline (ADR-0044 decision 2)",
    { timeout: 20_000 },
    async () => {
      const transport = claudeCodeTransport({ ...baseOpts("hang"), deadlineSeconds: 2 });
      const started = performance.now();
      const err = await errorFrom(transport.send(request()));
      expect(err.kind).toBe("transport");
      expect(err.message).toContain("deadline");
      expect(performance.now() - started).toBeLessThan(15_000);
    }
  );
});

describe("the binary is resolved from a trusted location, never PATH (ADR-0048)", () => {
  it("a claude planted earlier on PATH never runs; the transport spawns only its resolved binary (promoted red 3)", async () => {
    // The scanned repo plants a fake earlier on PATH. The transport resolves its
    // binary from the injected (trusted) location and ignores PATH entirely, so
    // the planted fake's sentinel never reaches the result and the injected
    // canonical fake is what ran.
    const env = { ...harnessEnv(), PATH: `${join(FAKE_ROOT, "path-hijack")}${delimiter}${process.env.PATH ?? ""}` };
    const transport = claudeCodeTransport({ ...baseOpts("canonical"), env });
    const result = await transport.send(request());
    expect(JSON.stringify(result)).not.toContain(PATH_SENTINEL);
    expect((result.response as { content: Array<Record<string, unknown>> }).content[0]!.input).toEqual({ findings: [] });
  });

  it("with the optional dependency installed, the trusted resolution returns the absolute claude binary from duckadrift's OWN node_modules (present-branch, closes the Stage 2+3 gap; ADR-0051)", () => {
    // Stage 2+3 could not exercise this branch: the package was absent, so the
    // happy-path resolution was unverified. It is now provisioned as an optional
    // dependency, so the resolution returns the real binary's absolute path from
    // the tool's own install. The binary is NOT spawned and no live call is made
    // the resolved path IS the assertion, no spawn.
    const bin = resolveTrustedClaudeBinary();
    expect(isAbsolute(bin)).toBe(true);
    const ownInstall = resolve(join(__dirname, ".."), "node_modules", "@anthropic-ai", "claude-code");
    expect(resolve(bin).startsWith(ownInstall)).toBe(true);
    expect(existsSync(bin)).toBe(true);
  });

  it("when claude-code is absent from the tool's install (an --omit=optional install), the resolution refuses loudly and never falls through to PATH (absent-branch)", () => {
    // A package name absent from duckadrift's node_modules stands in for an install
    // that omitted the optional dependency: toolRequire.resolve throws and the
    // resolution refuses, naming the trusted install and never PATH, so it can
    // never resolve a fake a scanned repo planted on PATH.
    let err: unknown;
    try {
      resolveTrustedClaudeBinary("@anthropic-ai/claude-code-omitted-from-this-install");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Tier1TransportError);
    const message = (err as Tier1TransportError).message;
    expect(message).toContain("not resolvable from duckadrift's own install");
    expect(message).toContain("PATH");
  });
});

describe("the scratch dir is anchored outside the scanned repo (ADR-0048, promoted red 4)", () => {
  it("refuses loudly when the temp-dir env would place the scratch under the repo", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "duckadrift-red4-repo-"));
    const evilTmp = join(repoRoot, ".evil-tmp");
    mkdirSync(evilTmp, { recursive: true });
    const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    try {
      // A repo that can set the run's temp-dir env points it under its own root.
      process.env.TMPDIR = evilTmp;
      process.env.TEMP = evilTmp;
      process.env.TMP = evilTmp;
      const transport = claudeCodeTransport({ deadlineSeconds: 60, repoRoot, env: harnessEnv(), claudeBinaryPath: fakeBinary("cwd-echo") });
      const err = await errorFrom(transport.send(request()));
      // Refused rather than proceeding with isolation defeated: the scratch is
      // never created under the repo.
      expect(err.kind).toBe("transport");
      expect(err.message.toLowerCase()).toContain("repo");
    } finally {
      for (const k of ["TMPDIR", "TEMP", "TMP"] as const) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("resolves the scratch outside the repo on a normal run (the cwd the CLI sees is not under repoRoot)", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "duckadrift-red4-ok-"));
    try {
      const transport = claudeCodeTransport({ deadlineSeconds: 60, repoRoot, env: harnessEnv(), claudeBinaryPath: fakeBinary("cwd-echo") });
      const result = await transport.send(request());
      const findings = ((result.response as Record<string, unknown>).content as Array<Record<string, unknown>>)[0]!
        .input as { findings: Array<{ observedCwd: string }> };
      const observedCwd = findings.findings[0]!.observedCwd;
      expect(resolve(observedCwd).startsWith(resolve(repoRoot))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("the deadline kill covers the whole process tree (ADR-0050)", () => {
  it(
    "POSIX: a grandchild the CLI spawns does not outlive the deadline; the whole process group is reaped",
    { timeout: 20_000 },
    async () => {
      if (process.platform === "win32") return; // POSIX-only: detached process groups
      const markerDir = mkdtempSync(join(tmpdir(), "duckadrift-grandchild-"));
      const marker = join(markerDir, "grandchild.pid");
      try {
        // The prompt carries the marker path; the hang-with-child fake reads it
        // from stdin and has its GRANDCHILD write its own pid there before both
        // hang. The deadline must reap the group, grandchild included.
        const req = request() as { messages: Array<{ content: string }> };
        req.messages[0]!.content = marker;
        const transport = claudeCodeTransport({ ...baseOpts("hang-with-child"), deadlineSeconds: 2 });
        const err = await errorFrom(transport.send(req));
        expect(err.message).toContain("deadline");

        // The grandchild recorded its pid before the deadline fired. Read it.
        let pid: number | undefined;
        for (let i = 0; i < 50 && pid === undefined; i++) {
          if (existsSync(marker)) {
            const raw = readFileSync(marker, "utf-8").trim();
            if (raw) pid = Number(raw);
          }
          if (pid === undefined) await sleep(100);
        }
        expect(pid).toBeGreaterThan(0);

        // After the group kill the grandchild must be gone. process.kill(pid, 0)
        // throws ESRCH when the process no longer exists. Under the old
        // direct-child kill the grandchild would be orphaned and still alive.
        let alive = true;
        for (let i = 0; i < 30 && alive; i++) {
          try {
            process.kill(pid!, 0);
            await sleep(100);
          } catch {
            alive = false;
          }
        }
        if (alive) {
          try {
            process.kill(pid!, "SIGKILL"); // clean up a survivor so the test never leaks a process
          } catch {
            // already gone
          }
        }
        expect(alive).toBe(false);
      } finally {
        rmSync(markerDir, { recursive: true, force: true });
      }
    }
  );

  it("Windows: a taskkill that cannot be confirmed surfaces a reason, never silently trusted (deterministic, platform injected)", async () => {
    // Cross-platform coverage of the Windows await-and-surface path: the platform
    // and the tree-killer are injected, so this runs on any runner. The live
    // taskkill invocation itself is proven by code plus the same manual standard
    // as the live claude path (ADR-0044); a Linux runner cannot exercise it.
    const nonZero = await killProcessTree({ pid: 4242 }, { platform: "win32", runTaskkill: async () => "taskkill exited 1" });
    expect(nonZero).toBe("taskkill exited 1");
    const failedToRun = await killProcessTree({ pid: 4242 }, { platform: "win32", runTaskkill: async () => "taskkill failed to run: ENOENT" });
    expect(failedToRun).toContain("failed to run");
    const confirmed = await killProcessTree({ pid: 4242 }, { platform: "win32", runTaskkill: async () => undefined });
    expect(confirmed).toBeUndefined();
    const noPid = await killProcessTree({ pid: undefined }, { platform: "win32" });
    expect(noPid).toContain("no child pid");
  });
});
