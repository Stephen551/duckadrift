#!/usr/bin/env node
// M4.1 corpus-capture orchestrator (ADR-0037 capture primitive, ADR-0040 split).
//
// Drives the checkpointed capture of S1/S4/S5 across the calibration corpus. It is
// NOT runtime code and sits on no verdict path — it is the money-spending harness
// that produces the recordings the director labels and the harness fits. Three
// properties matter and are enforced here, not trusted:
//
//   1. One transport shape. Every call goes through the SYNCHRONOUS liveTransport
//      the runner replays (ADR-0040) — no batch, whose envelope would not replay.
//   2. One calibration key. model/effort are FORCED to the tuple below, passed
//      straight to captureOne, so a target repo's own .duckadrift.yml can never
//      shift the key the calibration entry is stamped with.
//   3. Measured spend, never estimated (PDR §2.8). Cost is recomputed from the
//      .usage.json siblings on disk on every run, so the cumulative total and the
//      $6 stop-gate survive across separate public/private runs and process kills.
//
// Usage:
//   node scripts/capture-corpus.mjs --manifest <manifest.json> \
//        --corpus-root calibration-corpus [--also-remaining N] [--stop-gate 6.00]
//
// manifest.json: [{ "label": "fonthead", "root": "/abs/path", "adrDir": null,
//                   "side": "public" }, ...]  (adrDir null → auto-detect docs/adr)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const DIST = resolve("dist");
const { loadAdrLog } = await import(pathToFileURL(join(DIST, "adr/load.js")));
const { captureOne } = await import(pathToFileURL(join(DIST, "tier1/capture.js")));
const { liveTransport } = await import(pathToFileURL(join(DIST, "tier1/transport.js")));
const { TIER1_CHECKS } = await import(pathToFileURL(join(DIST, "tier1/checks.js")));

// The forced calibration key (PDR §2.6). Every recording in this corpus is stamped
// with exactly this tuple; the calibration entry keys on it. Recorded in the table.
const MODEL = "claude-sonnet-5";
const EFFORT = "high";
const CHECK_IDS = ["S1", "S4", "S5"];

// Sonnet 5 introductory pricing, $/1M tokens, in effect through 2026-08-31 (today
// is inside the window). Cache write ×1.25, cache read ×0.10 of base input.
const RATE = { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 };

function costOfUsage(u) {
  if (!u || typeof u !== "object") return 0;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return (
    (n(u.input_tokens) * RATE.input +
      n(u.output_tokens) * RATE.output +
      n(u.cache_creation_input_tokens) * RATE.cacheWrite +
      n(u.cache_read_input_tokens) * RATE.cacheRead) /
    1_000_000
  );
}

/** Walks the corpus tree and sums cost over every .usage.json — the measured ledger, recomputed from disk each run. */
function cumulativeSpend(corpusRoot) {
  let total = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.usage\.json$/i.test(entry)) {
        try {
          total += costOfUsage(JSON.parse(readFileSync(p, "utf-8")));
        } catch {
          /* an unreadable usage file contributes 0; the recording beside it is the paid artifact */
        }
      }
    }
  };
  walk(corpusRoot);
  return total;
}

function headSha(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim();
  } catch {
    return "(no-git)";
  }
}

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    "corpus-root": { type: "string" },
    "also-remaining": { type: "string", default: "0" },
    "stop-gate": { type: "string", default: "6.00" },
  },
});
if (!values.manifest || !values["corpus-root"]) {
  console.error("capture-corpus: --manifest and --corpus-root are required.");
  process.exit(2);
}

const corpusRoot = resolve(values["corpus-root"]);
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf-8"));
const alsoRemaining = Number(values["also-remaining"]);
const stopGate = Number(values["stop-gate"]);
const transport = liveTransport();

// The per-repo projection the stop-gate uses for as-yet-uncaptured repos:
// conservative = the most expensive repo seen so far, floored so an all-skip
// early run cannot lull the gate. The probe measured ~$0.14/whole-log call
// (~$0.40 for three checks); the floor is ~1.5x that, high enough to be
// conservative yet low enough that a full corpus (≤8 repos) does not false-trip
// the $6 gate before a single real cost is observed. Once real per-repo costs
// arrive, maxRepoCost governs and the floor is moot.
const PER_REPO_FLOOR = 0.6;

const rows = [];
let maxRepoCost = 0;

for (let i = 0; i < manifest.length; i++) {
  const spec = manifest[i];
  const outDir = join(corpusRoot, spec.side, spec.label);
  mkdirSync(outDir, { recursive: true });

  let ctx;
  try {
    ctx = loadAdrLog(resolve(spec.root), undefined, spec.adrDir ?? undefined);
  } catch (err) {
    console.error(`\n[${spec.label}] SETUP FAILED — ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[${spec.label}] resolve this repo's --adr-dir and re-run; nothing captured, nothing lost.`);
    process.exit(1);
  }

  const sha = headSha(resolve(spec.root));
  const acceptedAdrs = ctx.adrs.length;
  const perCheck = {};
  console.log(`\n=== ${spec.label} (${spec.side}) — ${acceptedAdrs} ADRs, HEAD ${sha.slice(0, 12)} ===`);

  for (const id of CHECK_IDS) {
    const check = TIER1_CHECKS.find((c) => c.id === id);
    const recordingPath = join(outDir, `${id.toLowerCase()}.recording.json`);
    let result;
    try {
      result = await captureOne({ ctx, check, config: { model: MODEL, effort: EFFORT }, transport, recordingPath });
    } catch (err) {
      // Loud, never silent (PDR §2.8): a transport failure stops the run with
      // every prior recording intact and re-runnable from here at zero re-pay.
      console.error(`[${spec.label}/${id}] TRANSPORT FAILED — ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[${spec.label}/${id}] nothing already captured was lost; re-run to resume.`);
      process.exit(1);
    }
    const cost = costOfUsage(result.usage);
    perCheck[id] = { status: result.status, usage: result.usage ?? null, cost, bytes: result.bytes };
    const tag =
      result.status === "captured"
        ? `captured  $${cost.toFixed(5)}`
        : result.status === "skipped-cached"
          ? "skipped-cached (no call, no spend)"
          : result.status === "skipped-no-input"
            ? "skipped-no-input"
            : `skipped-input-exceeds-cap (${result.bytes} bytes)`;
    console.log(`  ${id}: ${tag}`);
  }

  const repoCost = CHECK_IDS.reduce((s, id) => s + perCheck[id].cost, 0);
  maxRepoCost = Math.max(maxRepoCost, repoCost);
  rows.push({ label: spec.label, side: spec.side, sha, acceptedAdrs, perCheck, repoCost });

  const cumulative = cumulativeSpend(corpusRoot);
  const remaining = manifest.length - 1 - i + alsoRemaining;
  const projection = remaining * Math.max(maxRepoCost, PER_REPO_FLOOR);
  console.log(
    `  repo cost $${repoCost.toFixed(5)} · cumulative $${cumulative.toFixed(5)} · ${remaining} repo(s) left, projected +$${projection.toFixed(2)}`
  );

  if (cumulative + projection > stopGate) {
    console.error(
      `\nSTOP-GATE TRIPPED: cumulative $${cumulative.toFixed(5)} + projected $${projection.toFixed(2)} for ${remaining} remaining repo(s) > $${stopGate.toFixed(2)}.`
    );
    console.error("Reality diverged from the probe. Halting with every recording intact — route to the director with these numbers.");
    process.exit(3);
  }
}

console.log(`\n=== run complete — cumulative corpus spend $${cumulativeSpend(corpusRoot).toFixed(5)} ===`);
// Emit the machine-readable roll-up beside the corpus so the yield table is built
// from measured numbers, not retyped ones.
// Roll-up lands on the run's own side, so a private run's summary is gitignored
// with the rest of the private corpus, never on the committed side (ADR-0040).
const summarySide = manifest[0]?.side ?? "public";
mkdirSync(join(corpusRoot, summarySide), { recursive: true });
const summaryPath = join(corpusRoot, summarySide, `run-summary-${manifest.map((m) => m.label).join("-").slice(0, 40)}.json`);
writeFileSync(summaryPath, `${JSON.stringify(rows, null, 2)}\n`, "utf-8");
console.log(`summary → ${summaryPath}`);
