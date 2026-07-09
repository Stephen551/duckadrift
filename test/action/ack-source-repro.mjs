#!/usr/bin/env node
// Shell-level repro for the D5 ack-source false positive (ADR-0025). Outside
// vitest because it exercises the Action wrapper + git, not a src/ unit.
//
// action/pr-context-from-event.mjs used to populate the context field named
// `commitMessage` with the PR *title*, so D5's ADR-ACK check was blind to a
// marker placed in a commit message — the surface PDR §2.3 and ADR-0002's flow
// prescribe. On this repo's own PR #27 it fired a false positive on three
// governed oracle paths despite a standalone `ADR-ACK: 0002` commit trailer.
//
// This repro pins all three contracts against the REAL mjs + the built CLI:
//   A — a commit-message ADR-ACK satisfies the gate (the PR #27 shape). Red on
//       the pre-fix mjs (D5 fires because commitMessage carried the title),
//       green after (zero D5 findings).
//   B — an unacknowledged governed change still fails the gate (it still gates).
//   C — an ADR-ACK in the PR *title* does NOT count (the deliberate narrowing).
//
// Run: node test/action/ack-source-repro.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ACTION_SCRIPT = join(REPO, "action", "pr-context-from-event.mjs");
const CLI = join(REPO, "dist", "cli", "index.js");
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");

let failed = false;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failed = true;
};

const ADR_0002 = `---
status: accepted
governs:
  - "fixtures/**"
---

# ADR-0002 — Governed test decision

## Status

Accepted

## Context

Governs the fixtures directory.

## Decision

Test fixture.

## Consequences

None.
`;
const ADR_INDEX = "# ADR Index\n\n- [0002](0002-governed.md)\n";

const root = mkdtempSync(join(tmpdir(), "ack-source-"));
const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });

try {
  // Origin: master carries the ADR log; two feature branches diverge from it.
  const originDir = join(root, "origin");
  mkdirSync(join(originDir, "docs", "adr"), { recursive: true });
  git(originDir, ["init", "-q", "-b", "master"]);
  git(originDir, ["config", "user.email", "t@example.com"]);
  git(originDir, ["config", "user.name", "t"]);
  git(originDir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(originDir, "docs", "adr", "0002-governed.md"), ADR_0002);
  writeFileSync(join(originDir, "docs", "adr", "README.md"), ADR_INDEX);
  git(originDir, ["add", "-A"]);
  git(originDir, ["commit", "-q", "-m", "base: ADR log"]);

  const touchGoverned = (branch) => {
    git(originDir, ["checkout", "-q", "-b", branch, "master"]);
    mkdirSync(join(originDir, "fixtures"), { recursive: true });
    writeFileSync(join(originDir, "fixtures", "oracle.json"), "[]\n");
    git(originDir, ["add", "-A"]);
    git(originDir, ["commit", "-q", "-m", "change the governed oracle"]);
  };

  // Feature A: governed change + a dedicated empty commit whose body acks 0002.
  touchGoverned("featureA");
  git(originDir, ["commit", "-q", "--allow-empty", "-m", "Acknowledge the oracle change", "-m", "ADR-ACK: 0002"]);
  // Feature B: governed change, no acknowledgement anywhere.
  touchGoverned("featureB");
  git(originDir, ["checkout", "-q", "master"]);

  const runScenario = (branch, title, body) => {
    const cloneDir = join(root, `clone-${branch}-${Math.abs(hashStr(title))}`);
    execFileSync("git", ["clone", "-q", "--branch", branch, fileUrl(originDir), cloneDir], { stdio: "ignore" });
    for (const [k, v] of [["user.email", "t@example.com"], ["user.name", "t"], ["commit.gpgsign", "false"]])
      git(cloneDir, ["config", k, v]);
    const eventPath = join(cloneDir, "event.json");
    const ctxPath = join(cloneDir, "pr-context.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { ref: "master" }, title, body } }));
    execFileSync("node", [ACTION_SCRIPT, ctxPath], {
      cwd: cloneDir,
      env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GIT_TERMINAL_PROMPT: "0" },
      stdio: "ignore",
    });
    const context = JSON.parse(readFileSync(ctxPath, "utf-8"));
    // Report -> read the JSON for D5 findings.
    const mdOut = join(cloneDir, "r.md");
    execFileSync("node", [CLI, "report", cloneDir, "--pr-context", ctxPath, "--out", mdOut], { stdio: "ignore" });
    const report = JSON.parse(readFileSync(join(cloneDir, "r.json"), "utf-8"));
    const d5 = report.tier0Findings.filter((f) => f.check === "D5");
    // check -> exit code (0 = no failing findings).
    let checkExit = 0;
    try {
      execFileSync("node", [CLI, "check", cloneDir, "--pr-context", ctxPath], { stdio: "ignore" });
    } catch (e) {
      checkExit = e.status ?? 1;
    }
    return { context, d5, checkExit };
  };

  // --- Scenario A: commit-message ack satisfies the gate. ---
  const a = runScenario("featureA", "Fix the oracle drift", "This PR body contains no acknowledgement.");
  check("A: commit-message ADR-ACK satisfies D5 — zero D5 findings", a.d5.length === 0);
  check("A: log otherwise clean — check exits 0", a.checkExit === 0);
  check("A: context.commitMessage carries the ADR-ACK line", /^[ \t]*ADR-ACK:[ \t]*0*2[ \t]*$/m.test(a.context.commitMessage));
  check("A: context.commitMessage is the real messages, NOT the PR title", a.context.commitMessage !== "Fix the oracle drift");

  // --- Scenario B: unacknowledged governed change still fails. ---
  const b = runScenario("featureB", "Change the oracle", "No acknowledgement here either.");
  check("B: unacknowledged governed change fires exactly one D5 finding", b.d5.length === 1);
  check("B: the D5 finding is fact-tier (fails CI)", b.d5[0]?.advisory !== true);
  check("B: check exits non-zero", b.checkExit !== 0);

  // --- Scenario C: an ADR-ACK in the TITLE does not count. ---
  const c = runScenario("featureB", "ADR-ACK: 0002", "No acknowledgement in the body.");
  check("C: an ADR-ACK in the PR title does NOT satisfy the gate — D5 still fires", c.d5.length === 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

process.exit(failed ? 1 : 0);
