#!/usr/bin/env node
// Shell-level repro for the v0.1.6 shallow-checkout crash. Outside vitest because
// the bug is in an Action wrapper script and depends on git's shallow-clone
// behavior, not on any TypeScript unit.
//
// v0.1.5's action ran `git diff --name-only origin/<base>...HEAD` — a three-dot
// (merge-base) diff — with no guard. actions/checkout@v4 defaults to a shallow
// (depth-1) clone, which has no merge base with the base branch, so the diff
// fails and Node throws: the job dies red before duckadrift runs a single check.
// A false red on a valid repo.
//
// This repro builds exactly that: an origin with a base branch and a diverged
// feature branch, a genuine shallow clone (file:// so --depth is honored), the
// base fetched at depth 1 (as the action does), and a crafted pull_request event.
// It asserts the action never crashes:
//   A. reachable base  -> exit 0, deepen finds the merge base, pr-context written
//      with the PR's real changed file (the three-dot semantic is preserved).
//   B. unreachable base -> exit 0, graceful full-log fallback: no pr-context file,
//      loud ::warning::. Never a crash.
//
// Run: node test/action/shallow-checkout-repro.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_SCRIPT = join(HERE, "..", "..", "action", "pr-context-from-event.mjs");
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");

let failed = false;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failed = true;
};

// Build an origin repo: base branch `master` + a diverged `feature` branch.
const root = mkdtempSync(join(tmpdir(), "shallow-"));
const originDir = join(root, "origin");
mkdirSync(originDir, { recursive: true });
const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
try {
  git(originDir, ["init", "-q", "-b", "master"]);
  git(originDir, ["config", "user.email", "t@example.com"]);
  git(originDir, ["config", "user.name", "t"]);
  git(originDir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(originDir, "base.txt"), "base\n");
  git(originDir, ["add", "-A"]);
  git(originDir, ["commit", "-q", "-m", "base commit"]);
  // some extra base history so a shallow depth-1 clone genuinely omits the merge base
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(originDir, `base-${i}.txt`), `b${i}\n`);
    git(originDir, ["add", "-A"]);
    git(originDir, ["commit", "-q", "-m", `base ${i}`]);
  }
  git(originDir, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(join(originDir, "feature.txt"), "the PR's change\n");
  git(originDir, ["add", "-A"]);
  git(originDir, ["commit", "-q", "-m", "feature commit"]);
  git(originDir, ["checkout", "-q", "master"]); // leave origin on master

  const runAction = (cloneDir) => {
    const eventPath = join(cloneDir, "event.json");
    const outPath = join(cloneDir, "pr-context.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { ref: "master" }, title: "t", body: "b" } }));
    let code = 0;
    let stdout = "";
    try {
      stdout = execFileSync("node", [ACTION_SCRIPT, outPath], {
        cwd: cloneDir,
        env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GIT_TERMINAL_PROMPT: "0" },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      code = e.status ?? 1;
      stdout = (e.stdout ?? "").toString();
    }
    return { code, stdout, outPath };
  };

  const shallowClone = (name) => {
    const cloneDir = join(root, name);
    // A genuine shallow clone on the feature branch (file:// so --depth is honored).
    execFileSync("git", ["clone", "--depth=1", "--branch", "feature", fileUrl(originDir), cloneDir], { stdio: "ignore" });
    for (const [k, v] of [["user.email", "t@example.com"], ["user.name", "t"], ["commit.gpgsign", "false"]])
      git(cloneDir, ["config", k, v]);
    // The action fetches the base at depth 1 — no merge base with HEAD.
    git(cloneDir, ["fetch", "--depth=1", "origin", "master:refs/remotes/origin/master"]);
    return cloneDir;
  };

  // --- Scenario A: reachable base — deepen finds the merge base. ---
  const cloneA = shallowClone("cloneA");
  const a = runAction(cloneA);
  check("A: shallow checkout, reachable base -> exits 0 (no crash)", a.code === 0);
  const ctxWritten = existsSync(a.outPath);
  check("A: a pr-context file was written (deepen recovered the merge base)", ctxWritten);
  if (ctxWritten) {
    const ctx = JSON.parse(readFileSync(a.outPath, "utf-8"));
    check(
      "A: changedFiles is the PR's real change (feature.txt), not base-branch commits",
      ctx.changedFiles.includes("feature.txt") && !ctx.changedFiles.some((f) => f.startsWith("base"))
    );
  }

  // --- Scenario B: unreachable base — graceful full-log fallback, still exit 0. ---
  const cloneB = shallowClone("cloneB");
  git(cloneB, ["remote", "set-url", "origin", fileUrl(join(root, "does-not-exist"))]);
  const b = runAction(cloneB);
  check("B: shallow checkout, unreachable base -> exits 0 (graceful, no crash)", b.code === 0);
  check("B: no pr-context file written -> action runs full-log mode", !existsSync(b.outPath));
  check("B: loud ::warning:: emitted (skip is stated, not silent)", /::warning[^\n]*duckadrift/.test(b.stdout));
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
