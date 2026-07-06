#!/usr/bin/env node
// Shell-level repro for NEW-B — the D5 git-quotepath false positive in
// action/pr-context-from-event.mjs. Outside vitest because it depends on git's
// path-quoting behavior, not on any TypeScript unit.
//
// git's `core.quotepath` (on by default) renders a non-ASCII path as an
// octal-escaped, double-quoted string: `"docs/adr/0001-\303\251.md"`. The old
// script passed that straight into changedFiles, and D5's exact-identity "the PR
// modified the ADR" match then failed against the real UTF-8 filename — firing
// the flagship gate on a genuinely touched ADR. `-c core.quotepath=false` keeps
// the raw UTF-8 name, so D5's exact match works.
//
// This repro builds a git repo with a non-ASCII ADR, modifies it, runs the real
// action script, and asserts changedFiles carries the raw UTF-8 name (which is
// what D5 needs to skip). Exit non-zero if it does not.
//
// Run: node test/action/quotepath-repro.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_SCRIPT = join(HERE, "..", "..", "action", "pr-context-from-event.mjs");
const ADR_REL = "docs/adr/0001-é.md"; // 0001-é.md — a non-ASCII ADR name

const dir = mkdtempSync(join(tmpdir(), "quotepath-"));
const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" });

try {
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);

  mkdirSync(join(dir, "docs", "adr"), { recursive: true });
  writeFileSync(join(dir, ADR_REL), "v1\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "base"]);
  // Fake the remote base ref the script diffs against, then modify the ADR.
  git(["update-ref", "refs/remotes/origin/main", git(["rev-parse", "HEAD"]).trim()]);
  writeFileSync(join(dir, ADR_REL), "v2 modified\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "modify the non-ASCII ADR"]);

  const eventPath = join(dir, "event.json");
  const outPath = join(dir, "pr-context.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { ref: "main" }, title: "t", body: "b" } }));
  execFileSync("node", [ACTION_SCRIPT, outPath], {
    cwd: dir,
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
    stdio: "ignore",
  });

  const ctx = JSON.parse(readFileSync(outPath, "utf-8"));
  const ok = ctx.changedFiles.includes(ADR_REL); // raw UTF-8, not the git-quoted octal form
  console.log(
    `${ok ? "PASS" : "FAIL"} — changedFiles carries the raw UTF-8 ADR name (D5's exact-identity skip works): ` +
      JSON.stringify(ctx.changedFiles)
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
