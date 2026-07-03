#!/usr/bin/env node
// Builds a duckadrift PR-context file (--pr-context) from the GitHub Actions
// pull_request event payload. Not part of the CLI (src/) — the CLI knows
// nothing about GitHub; this is the Action wrapper's own translation layer.
import { execSync } from "node:child_process";
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

const changedFiles = execSync(`git diff --name-only "origin/${baseRef}...HEAD"`, {
  encoding: "utf-8",
})
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
