#!/usr/bin/env node
// Builds a duckadrift PR-context file (--pr-context) from the GitHub Actions
// pull_request event payload. Not part of the CLI (src/) — the CLI knows
// nothing about GitHub; this is the Action wrapper's own translation layer.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const eventPath = process.env.GITHUB_EVENT_PATH;
const outPath = process.argv[2];

if (!outPath) {
  console.error("Usage: pr-context-from-event.mjs <output-path>");
  process.exit(1);
}
if (!eventPath) {
  console.error("GITHUB_EVENT_PATH not set — this script runs inside a GitHub Actions job.");
  process.exit(1);
}

const event = JSON.parse(readFileSync(eventPath, "utf-8"));
const pr = event.pull_request;

if (!pr) {
  console.log("Not a pull_request event — no PR context to derive; D5 will not run.");
  process.exit(0);
}

const baseRef = pr.base?.ref;
if (!baseRef) {
  console.error("Event payload has no pull_request.base.ref — cannot diff.");
  process.exit(1);
}

// execFileSync with an args array — no shell, so `baseRef` is passed to git as a
// single literal argument and can never be interpreted as shell syntax (B-3: a
// `$IFS`-style, git-ref-valid payload in a branch name executed on the runner
// under the old shell-string execSync).
// `-c core.quotepath=false` (NEW-B): git's default quotepath emits a non-ASCII
// path as an octal-escaped, double-quoted string (`"docs/adr/0001-\303\251.md"`),
// which D5's exact-identity "the PR modified the ADR" match then fails against
// the real UTF-8 filename — firing the flagship gate on a genuinely touched ADR.
// Disabling it at the source keeps changedFiles as raw UTF-8, no unquoter in D5.
const changedFiles = execFileSync(
  "git",
  ["-c", "core.quotepath=false", "diff", "--name-only", `origin/${baseRef}...HEAD`],
  { encoding: "utf-8" }
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const context = {
  changedFiles,
  commitMessage: pr.title ?? "",
  prBody: pr.body ?? "",
};

writeFileSync(outPath, JSON.stringify(context, null, 2), "utf-8");
console.log(`Wrote PR context (${changedFiles.length} changed file(s)) to ${outPath}`);
