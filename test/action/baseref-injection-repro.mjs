#!/usr/bin/env node
// Shell-level repro for B-3 — the baseRef command injection in
// action/pr-context-from-event.mjs. This lives outside the vitest suite because
// the vulnerability is in an Action wrapper script (not the CLI in src/) and the
// exploit is a property of shell string evaluation, not of any TypeScript unit.
//
// The runner shell is bash (ubuntu-latest). The injection: pr.base.ref is
// interpolated into a shell string `git diff --name-only "origin/${baseRef}...HEAD"`
// and evaluated by the shell, so a git-ref-valid, no-space `$(...)` payload runs
// arbitrary commands. `$IFS` supplies the space `touch` needs without one in the
// ref text.
//
// This script proves three things and exits non-zero if the SHIPPED fix leaks:
//   1. the old form (a shell string) under bash runs the payload   → sentinel created (the bug)
//   2. the fix form (execFileSync args array) does not              → no sentinel
//   3. the real, current action/pr-context-from-event.mjs           → no sentinel
//
// Run: node test/action/baseref-injection-repro.mjs

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_SCRIPT = join(HERE, "..", "..", "action", "pr-context-from-event.mjs");

// A git-ref-shaped payload with no spaces: `$(touch${IFS}<sentinel>)`.
const PAYLOAD_REF = (sentinel) => `$(touch${"${IFS}"}${sentinel})`;

let failed = false;
const check = (label, condition) => {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failed = true;
};

// ---- 1. The old form (shell string) under bash — the vulnerability. --------
{
  const dir = mkdtempSync(join(tmpdir(), "baseref-old-"));
  const sentinel = join(dir, "pwned");
  const baseRef = PAYLOAD_REF("pwned");
  try {
    execSync(`git diff --name-only "origin/${baseRef}...HEAD"`, { cwd: dir, shell: "bash", stdio: "ignore" });
  } catch {
    /* git exits non-zero on the bogus ref — irrelevant; the payload already ran during expansion. */
  }
  const leaked = existsSync(sentinel);
  console.log(`  [class] old execSync form under bash created the sentinel: ${leaked}`);
  console.log(`  [class] this is the behavior the fix removes (informational, not a pass/fail gate).`);
  rmSync(dir, { recursive: true, force: true });
}

// ---- 2. The fix form (execFileSync, args array, no shell). ------------------
{
  const dir = mkdtempSync(join(tmpdir(), "baseref-fix-"));
  const sentinel = join(dir, "pwned");
  const baseRef = PAYLOAD_REF("pwned");
  try {
    execFileSync("git", ["diff", "--name-only", `origin/${baseRef}...HEAD`], { cwd: dir, stdio: "ignore" });
  } catch {
    /* git errors on the bogus ref; no shell ran, so nothing was executed. */
  }
  check("fix form (execFileSync) did NOT run the injected command", !existsSync(sentinel));
  rmSync(dir, { recursive: true, force: true });
}

// ---- 3. The real, current action script end-to-end. ------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "baseref-mjs-"));
  const sentinel = join(dir, "pwned");
  const eventPath = join(dir, "event.json");
  const outPath = join(dir, "pr-context.json");
  writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { base: { ref: PAYLOAD_REF("pwned") }, title: "t", body: "b" } })
  );
  try {
    execFileSync("node", [ACTION_SCRIPT, outPath], {
      cwd: dir,
      env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
      stdio: "ignore",
    });
  } catch {
    /* the git diff fails on the bogus ref; the point is only whether the payload executed. */
  }
  check("real action/pr-context-from-event.mjs did NOT run the injected command", !existsSync(sentinel));
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
