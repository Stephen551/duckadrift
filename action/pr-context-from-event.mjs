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

// The changed-file set is the PR's *actual* changes against the base branch, via
// a three-dot (merge-base) diff.
// - execFileSync with an args array — no shell, so `baseRef` is passed to git as
//   a single literal argument and can never be interpreted as shell syntax (B-3:
//   a `$IFS`-style, git-ref-valid payload executed on the runner under the old
//   shell-string execSync).
// - `-c core.quotepath=false` (NEW-B): git's default quotepath emits a non-ASCII
//   path as an octal-escaped, double-quoted string, which D5's exact-identity
//   "the PR modified the ADR" match then fails against the real UTF-8 filename —
//   firing the flagship gate on a genuinely touched ADR. Disabling it keeps
//   changedFiles as raw UTF-8, no unquoter in D5.
const runThreeDotDiff = () =>
  execFileSync(
    "git",
    ["-c", "core.quotepath=false", "diff", "--name-only", `origin/${baseRef}...HEAD`],
    { encoding: "utf-8" }
  );

// A three-dot diff needs a merge base, i.e. shared history between HEAD and the
// base branch. `actions/checkout@v4` defaults to a shallow (depth-1) clone, which
// has none — so `origin/base...HEAD` fails outright and, unguarded, Node throws
// and the job dies red before duckadrift runs a single check: a false red on a
// valid repo, the exact class this tool exists to prevent, in its own wrapper.
// Best-effort deepen the history and retry the SAME three-dot diff. A two-dot
// diff is deliberately NOT used as a fallback: `origin/base..HEAD` reports the
// base branch's own post-divergence commits as if the PR made them, firing D5
// false positives — trading a crash for a wrong finding. Correctness over
// convenience: the changed-file set must be the PR's real changes.
let diffOutput;
try {
  diffOutput = runThreeDotDiff();
} catch {
  try {
    try {
      // Fetch the full history missing from the shallow clone.
      execFileSync("git", ["fetch", "--unshallow", "origin"], { stdio: "ignore" });
    } catch {
      // --unshallow errors on an already-complete repo; deepen by a bounded
      // amount instead (covers a PR that diverged within the last ~200 commits).
      execFileSync("git", ["fetch", "--deepen=200", "origin"], { stdio: "ignore" });
    }
    diffOutput = runThreeDotDiff();
  } catch {
    // Still no merge base after deepening (e.g. an unreachable base). Degrade
    // loudly — never crash: emit a workflow-command warning and exit 0 WITHOUT
    // writing the pr-context file. The action's run step keys on that file's
    // presence, so its absence runs full-log mode — D1-D4, D6, and D7 all still
    // run (D7 still catches real index drift); only the PR-scoped D5 governed-
    // path gate is skipped, and the skip is stated, never silent (the Pact).
    // Same graceful shape as the "not a pull_request event" path above.
    console.log(
      "::warning title=duckadrift::Could not compute the PR's changed files — the checkout is shallow / has no merge base with the base branch. Running full-log checks; the D5 governed-path gate was skipped. Add `fetch-depth: 0` to actions/checkout to enable PR-scoped checks."
    );
    process.exit(0);
  }
}

const changedFiles = diffOutput
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

// D5's ack contract (PDR §2.3) reads the marker from "commit message or PR body".
// This field used to carry pr.title as a stand-in — a mislabel that made the gate
// blind to the surface the repo's own ADR-0002 flow prescribes (a dedicated
// ADR-ACK commit), firing a false positive on this repo's own PR #27 during the
// clause-A window (ADR-0025). The messages come from the same merge-base range
// as the changed files, so the ack surface and the change surface are the same
// commits by construction. The title is deliberately NOT included: it was never
// a contract surface, and silently widening ack surfaces is the B-5 failure
// class in the other direction.
const collectCommitMessages = () =>
  execFileSync(
    "git",
    ["log", "--format=%B%x00", `origin/${baseRef}...HEAD`],
    { encoding: "utf-8" }
  );

let commitMessages;
try {
  commitMessages = collectCommitMessages();
} catch {
  console.log(
    "::warning title=duckadrift::Could not read the PR's commit messages for the ADR-ACK check — running full-log checks; the D5 governed-path gate was skipped rather than run blind to one of its acknowledgement surfaces."
  );
  process.exit(0);
}

const context = {
  changedFiles,
  commitMessage: commitMessages,
  prBody: pr.body ?? "",
};

writeFileSync(outPath, JSON.stringify(context, null, 2), "utf-8");
console.log(`Wrote PR context (${changedFiles.length} changed file(s)) to ${outPath}`);
