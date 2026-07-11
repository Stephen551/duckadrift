#!/usr/bin/env node
// M4.2 diff-mode capture (ADR-0041, on the ADR-0037 primitive). For each
// harvested candidate: reconstruct the tree in a guarded temporary worktree at
// the candidate SHA, build the PR proxy (changed files vs first parent), and
// capture S2/S3 through the SAME synchronous liveTransport the runner replays.
// Checkpointed: a recording whose promptHash matches is never re-paid.
//
// Money discipline (probe-first, standing law from PR #40): the first
// --probe N calls are the measurement tranche — after them the script prints
// measured cost/call and the projection over the remaining candidates and
// REFUSES to continue unless diffSpend + projection <= the gate. The gate is
// re-checked before every subsequent call. Spend is measured from the
// .usage.json siblings under */diffs/** only (M4.1's whole-log spend is a
// different ledger), recomputed from disk so kills and resumes stay honest.
//
// Usage:
//   node scripts/capture-diffs.mjs --harvest <harvest.json> \
//        --corpus-root calibration-corpus --worktree-base <dir> \
//        [--probe 10] [--gate 4.00] [--only public|private]

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DIST = resolve("dist");
const { loadAdrLog } = await import(pathToFileURL(join(DIST, "adr/load.js")));
const { captureOne } = await import(pathToFileURL(join(DIST, "tier1/capture.js")));
const { liveTransport } = await import(pathToFileURL(join(DIST, "tier1/transport.js")));
const { TIER1_CHECKS } = await import(pathToFileURL(join(DIST, "tier1/checks.js")));

const MODEL = "claude-sonnet-5";
const EFFORT = "high";
const RATE = { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 };

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });

function costOfUsage(u) {
  if (!u || typeof u !== "object") return 0;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return (n(u.input_tokens) * RATE.input + n(u.output_tokens) * RATE.output +
    n(u.cache_creation_input_tokens) * RATE.cacheWrite + n(u.cache_read_input_tokens) * RATE.cacheRead) / 1e6;
}

/** Diff-ledger spend only: sums .usage.json under any diffs/ directory. */
function diffSpend(corpusRoot) {
  let total = 0;
  const walk = (dir, underDiffs) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, underDiffs || entry === "diffs");
      else if (underDiffs && /\.usage\.json$/i.test(entry)) {
        try { total += costOfUsage(JSON.parse(readFileSync(p, "utf-8"))); } catch { /* recording is the paid artifact */ }
      }
    }
  };
  walk(corpusRoot, false);
  return total;
}

const { values } = parseArgs({
  options: {
    harvest: { type: "string" },
    "corpus-root": { type: "string" },
    "worktree-base": { type: "string" },
    probe: { type: "string", default: "10" },
    gate: { type: "string", default: "4.00" },
    only: { type: "string" },
  },
});
if (!values.harvest || !values["corpus-root"] || !values["worktree-base"]) {
  console.error("capture-diffs: --harvest, --corpus-root, and --worktree-base are required.");
  process.exit(2);
}
const corpusRoot = resolve(values["corpus-root"]);
const worktreeBase = resolve(values["worktree-base"]);
const PROBE = Number(values.probe);
const GATE = Number(values.gate);
const harvest = JSON.parse(readFileSync(resolve(values.harvest), "utf-8"))
  .filter((r) => !values.only || r.side === values.only);
mkdirSync(worktreeBase, { recursive: true });

// Flatten to a deterministic call list: repo order as harvested, S3 then S2,
// newest-first within each — the same order every run, so the checkpoint
// resume and the probe tranche are stable.
const calls = [];
for (const repo of harvest) {
  for (const [checkId, list] of [["S3", repo.s3], ["S2", repo.s2]]) {
    for (const cand of list) calls.push({ repo, checkId, sha12: cand.sha12 });
  }
}
console.log(`${calls.length} candidate calls (probe tranche: first ${PROBE}); gate $${GATE.toFixed(2)} on the diff ledger.`);

const transport = liveTransport();
let attempted = 0, captured = 0, cachedSkips = 0, otherSkips = 0;
let measuredCalls = 0, measuredCost = 0;

for (const { repo, checkId, sha12 } of calls) {
  const check = TIER1_CHECKS.find((c) => c.id === checkId);
  const outDir = join(corpusRoot, repo.side, repo.label, "diffs", sha12);
  const recordingPath = join(outDir, `${checkId.toLowerCase()}.recording.json`);

  // Checkpoint fast-path is inside captureOne; the worktree is only needed to
  // build the request. Cheap pre-check: if the recording exists we still build
  // the request to hash-verify, so the worktree is always constructed. That is
  // the price of the ADR-0028 contract — a checkpoint is only trusted against
  // the request we would send NOW.
  const fullSha = git(repo.root, ["rev-parse", sha12]).trim();
  const wt = join(worktreeBase, `${repo.label}-${sha12}`);
  try {
    if (!existsSync(wt)) git(repo.root, ["worktree", "add", "--detach", "--force", wt, fullSha]);
    // SHA guard (the M4.1 lesson, one commit old): a worktree not at the
    // recorded SHA refuses to capture.
    const at = git(wt, ["rev-parse", "HEAD"]).trim();
    if (at !== fullSha) throw new Error(`worktree at ${at.slice(0, 12)}, candidate is ${sha12} — refusing`);

    const changed = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", `${fullSha}^1`, fullSha])
      .split("\n").filter(Boolean);
    const prPath = join(worktreeBase, `pr-${repo.label}-${sha12}.json`);
    writeFileSync(prPath, JSON.stringify({ changedFiles: changed }), "utf-8");

    const ctx = loadAdrLog(wt, prPath, repo.adrDir);
    mkdirSync(outDir, { recursive: true });
    attempted++;
    const result = await captureOne({ ctx, check, config: { model: MODEL, effort: EFFORT }, transport, recordingPath });
    const spent = diffSpend(corpusRoot);

    if (result.status === "captured") {
      captured++;
      const c = costOfUsage(result.usage);
      measuredCalls++; measuredCost += c;
      console.log(`  [${repo.label}/${sha12}/${checkId}] captured $${c.toFixed(5)} · diff-ledger $${spent.toFixed(5)}`);
    } else if (result.status === "skipped-cached") {
      cachedSkips++;
      console.log(`  [${repo.label}/${sha12}/${checkId}] skipped-cached (no spend)`);
    } else {
      otherSkips++;
      console.log(`  [${repo.label}/${sha12}/${checkId}] ${result.status}${result.bytes ? ` (${result.bytes} bytes)` : ""}`);
    }

    // The projection gate, re-checked after EVERY paid call once the probe
    // tranche has priced the work. Remaining = candidate calls not yet
    // attempted; projected at the measured average (never assumed).
    if (measuredCalls >= Math.min(PROBE, calls.length)) {
      const avg = measuredCost / measuredCalls;
      const projection = (calls.length - attempted) * avg;
      if (measuredCalls === Math.min(PROBE, calls.length)) {
        console.log(`\n== PROBE TRANCHE COMPLETE: ${measuredCalls} paid calls, $${measuredCost.toFixed(5)} — avg $${avg.toFixed(5)}/call ==`);
        console.log(`== projection for remaining ${calls.length - attempted} candidates: $${projection.toFixed(2)}; ledger ${spent.toFixed(5)} + projection ${projection.toFixed(2)} vs gate $${GATE.toFixed(2)} ==\n`);
      }
      if (spent + projection > GATE) {
        console.error(`STOP: diff-ledger $${spent.toFixed(5)} + projection $${projection.toFixed(2)} > $${GATE.toFixed(2)} — halting with every recording intact. Route with these numbers.`);
        process.exit(3);
      }
    }
  } catch (err) {
    console.error(`  [${repo.label}/${sha12}/${checkId}] FAILED — ${err instanceof Error ? err.message : String(err)}`);
    console.error("  nothing already captured was lost; re-run to resume.");
    process.exit(1);
  } finally {
    try { git(repo.root, ["worktree", "remove", "--force", wt]); } catch { /* leftover pruned next run */ }
  }
}

console.log(`\n=== diff capture complete: ${captured} captured, ${cachedSkips} cached, ${otherSkips} named skips; diff-ledger $${diffSpend(corpusRoot).toFixed(5)} ===`);
