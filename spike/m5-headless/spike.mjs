#!/usr/bin/env node
// THROWAWAY SPIKE — M5.0 PR B evidence collector. Not production code, not
// imported by anything, never wired into the build. It measures Claude Code
// headless (`claude -p`) behavior and writes captured artifacts for the PR
// ledger: two same-prompt captures (schema stability), an auth-failure
// sample, and a scoped mid-call transport-failure sample. Every live call it
// makes is counted and printed at the end.
//
// Spawn discipline: a minimal allowlisted environment. ANTHROPIC_API_KEY is
// deliberately ABSENT so the CLI resolves the machine's Claude Code login
// (the director's dev-environment auth), never the metered API key. The
// working directory is an empty scratch dir, proving the invocation carries
// no repo-context assumption.
//
// Runtime model is pinned to claude-sonnet-5 per the director's ruling.
// Fable is build-time only and never appears here.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(__dirname, "captures");
mkdirSync(CAPTURES, { recursive: true });

const SCRATCH = join(tmpdir(), `m5-headless-spike-${process.pid}`);
const EMPTY_CWD = join(SCRATCH, "empty-cwd");
const EMPTY_CONFIG = join(SCRATCH, "empty-config");
mkdirSync(EMPTY_CWD, { recursive: true });
mkdirSync(EMPTY_CONFIG, { recursive: true });

// Windows needs SystemRoot for winsock; the CLI needs the profile dirs to
// find its stored login. Nothing ANTHROPIC_* or CLAUDE_* passes through.
const ENV_ALLOWLIST = [
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
];

function baseEnv() {
  const env = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

// --strict-mcp-config is load-bearing: without it, headless in an EMPTY
// directory still loads the user-scope MCP config (~60k cache-creation
// tokens of tool definitions and a fleet of third-party dials measured in
// the first run). The canonical invocation is hermetic.
const PINNED_ARGS = [
  "-p",
  "Reply with exactly: pong",
  "--output-format",
  "json",
  "--model",
  "claude-sonnet-5",
  "--effort",
  "high",
  "--no-session-persistence",
  "--strict-mcp-config",
];

let liveCalls = 0;

function runClaude(label, args, extraEnv, timeoutMs) {
  liveCalls += 1;
  const startedAt = Date.now();
  // The claude shim on Windows needs a shell, and execFile+shell CONCATENATES
  // args without quoting (DEP0190): the first spike run's prompt silently
  // never reached the model. Every arg is pre-quoted; none carries quotes.
  const quoted = process.platform === "win32" ? args.map((a) => `"${a}"`) : args;
  return new Promise((resolve) => {
    const child = execFile(
      "claude",
      quoted,
      {
        cwd: EMPTY_CWD,
        env: { ...baseEnv(), ...extraEnv },
        timeout: timeoutMs,
        killSignal: "SIGTERM",
        shell: process.platform === "win32", // claude is a .cmd shim on Windows
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          label,
          argv: ["claude", ...args],
          exitCode: error === null ? 0 : (error.code ?? "killed"),
          killed: error !== null && error.killed === true,
          durationMs: Date.now() - startedAt,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      }
    );
    child.stdin?.end();
  });
}

function saveCapture(name, result) {
  writeFileSync(join(CAPTURES, `${name}.stdout.json`), result.stdout);
  const meta = {
    label: result.label,
    argv: result.argv,
    exitCode: result.exitCode,
    killed: result.killed,
    durationMs: result.durationMs,
    stderr: result.stderr,
    envPassedThrough: ENV_ALLOWLIST.filter((k) => process.env[k] !== undefined),
    cwd: "an empty scratch directory outside any repository",
  };
  writeFileSync(join(CAPTURES, `${name}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
  console.log(`${name}: exit=${result.exitCode} durationMs=${result.durationMs}`);
}

// A local forward proxy that tunnels CONNECT to the real host, then destroys
// both sockets a few seconds after the tunnel opens: a genuine mid-call
// transport severance scoped to the spawned process. The machine's own
// network is never touched.
function startSeveringProxy(severAfterMs) {
  return new Promise((resolveStarted) => {
    const events = [];
    const server = createServer();
    server.on("connection", (socket) => {
      socket.once("data", (head) => {
        const line = head.toString("utf8").split("\r\n")[0] ?? "";
        const match = /^CONNECT\s+([^\s:]+):(\d+)/.exec(line);
        if (!match) {
          events.push(`non-CONNECT request: ${line}`);
          socket.destroy();
          return;
        }
        events.push(`CONNECT ${match[1]}:${match[2]}`);
        const upstream = connect(Number(match[2]), match[1], () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          socket.pipe(upstream);
          upstream.pipe(socket);
          setTimeout(() => {
            events.push(`severed tunnel after ${severAfterMs}ms`);
            socket.destroy();
            upstream.destroy();
          }, severAfterMs);
        });
        upstream.on("error", (e) => {
          events.push(`upstream error: ${e.message}`);
          socket.destroy();
        });
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      resolveStarted({
        port: server.address().port,
        events,
        close: () => server.close(),
      });
    });
  });
}

// Capture A and B: the pinned invocation, twice, same prompt (answers 1, 2,
// 3, 4, 6).
const a = await runClaude("capture-a", PINNED_ARGS, {}, 180_000);
saveCapture("capture-a", a);
if (a.exitCode !== 0) {
  console.error("capture-a failed; stopping before further spend. See its meta for stderr.");
  console.log(`live calls attempted: ${liveCalls}`);
  process.exit(1);
}
const b = await runClaude("capture-b", PINNED_ARGS, {}, 180_000);
saveCapture("capture-b", b);

// Auth-failure capture: an isolated empty config dir (no stored login) plus a
// syntactically bogus token. No successful auth means no spend.
const authFail = await runClaude(
  "auth-failure",
  PINNED_ARGS,
  {
    CLAUDE_CONFIG_DIR: EMPTY_CONFIG,
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-invalid-spike-probe",
  },
  120_000
);
saveCapture("auth-failure", authFail);

// Transport-failure capture: sever the tunnel mid-call, scoped to this one
// spawned process via HTTPS_PROXY. 150ms after the tunnel opens: long enough
// for TLS to start, short enough that no request ever completes. The first
// run's 3s window proved the CLI retries transparently and still succeeds;
// a real failure sample needs total denial.
const proxy = await startSeveringProxy(150);
const transportFail = await runClaude(
  "transport-failure",
  PINNED_ARGS,
  { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`, HTTP_PROXY: `http://127.0.0.1:${proxy.port}` },
  120_000
);
proxy.close();
saveCapture("transport-failure", transportFail);
writeFileSync(join(CAPTURES, "transport-failure.proxy-events.json"), JSON.stringify(proxy.events, null, 2) + "\n");
console.log(`proxy events: ${JSON.stringify(proxy.events)}`);

console.log(`live calls attempted: ${liveCalls}`);
