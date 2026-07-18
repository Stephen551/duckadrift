#!/usr/bin/env node
// THROWAWAY SPIKE: M5.3 PR D evidence collector. Measures how the headless
// CLI carries (a) a replacing system prompt and (b) forced structured output,
// the two halves of prompt realization the #54 ledger named as the gap.
// Direct spawn of the native claude.exe (resolved from the npm shim), shell
// free, pristine argv; prompt via stdin; hermetic env allowlist with the
// metered API key excluded so auth resolves to the subscription login.
// Every live call is counted and printed.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(__dirname, "captures");
mkdirSync(CAPTURES, { recursive: true });

const SCRATCH = join(tmpdir(), `m5-prompt-probe-${process.pid}`);
mkdirSync(join(SCRATCH, "empty-cwd"), { recursive: true });

const CLAUDE_EXE =
  "C:/Users/steph/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe";

const ENV_ALLOWLIST = [
  "PATH", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "USERNAME",
];
const env = {};
for (const key of ENV_ALLOWLIST) if (process.env[key] !== undefined) env[key] = process.env[key];

const SYSTEM_FILE = join(SCRATCH, "system.txt");
writeFileSync(
  SYSTEM_FILE,
  "You are the duckadrift prompt-realization probe. The system token is QUACKPROBE. When asked for the system token, answer with exactly that token."
);

const SCHEMA = JSON.stringify({
  type: "object",
  properties: { system_token: { type: "string" }, echo: { type: "string" } },
  required: ["system_token", "echo"],
});

const args = [
  "-p",
  "--output-format", "json",
  "--model", "claude-sonnet-5",
  "--effort", "high",
  "--no-session-persistence",
  "--strict-mcp-config",
  "--tools", "",
  "--system-prompt-file", SYSTEM_FILE,
  "--json-schema", SCHEMA,
];

let liveCalls = 0;
liveCalls += 1;
const startedAt = Date.now();
execFile(
  CLAUDE_EXE,
  args,
  { cwd: join(SCRATCH, "empty-cwd"), env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  (error, stdout, stderr) => {
    const meta = {
      argv: ["claude.exe", ...args.map((a) => (a === SYSTEM_FILE ? "<system-file>" : a))],
      exitCode: error === null ? 0 : (error.code ?? "killed"),
      durationMs: Date.now() - startedAt,
      stderr: String(stderr),
      spawn: "direct claude.exe, shell free, prompt via stdin, empty cwd",
    };
    writeFileSync(join(CAPTURES, "probe-system-schema.stdout.json"), String(stdout));
    writeFileSync(join(CAPTURES, "probe-system-schema.meta.json"), JSON.stringify(meta, null, 2) + "\n");
    console.log(`probe: exit=${meta.exitCode} durationMs=${meta.durationMs}`);
    console.log(`live calls: ${liveCalls}`);
  }
).stdin?.end("Reply with system_token set to the system token, and echo set to exactly: pong");
