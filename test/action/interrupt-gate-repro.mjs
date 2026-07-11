#!/usr/bin/env node
// M4.4 action-layer repro (ADR-0042 gate 1): under the SHIPPED calibration, the
// interrupt wrapper posts NOTHING — proven by running emit-interrupts.mjs on a
// findings-bearing report with `gh` entirely absent from PATH. If the script
// attempted any gh invocation it would fail with ENOENT and exit non-zero; a
// clean exit with "0 interrupt(s)" is therefore proof of a network-free,
// post-free steady state.
//
// The report.json is built through the REAL pipeline pieces (consume → route →
// buildJsonReport) against the repo's actual shipped calibration.json, with a
// findings fixture carrying high-confidence findings at every severity.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DIST = join(ROOT, "dist");

const { loadAdrLog } = await import(pathToFileURL(join(DIST, "adr/load.js")));
const { consumeCalibration } = await import(pathToFileURL(join(DIST, "tier1/calibration/consume.js")));
const { routeFindings } = await import(pathToFileURL(join(DIST, "tier1/calibration/route.js")));
const { buildJsonReport, withTier1Run } = await import(pathToFileURL(join(DIST, "report/write.js")));

const fail = (msg) => {
  console.error(`REPRO FAILED: ${msg}`);
  process.exit(1);
};

// A findings-bearing tree: the synthetic 4-ADR fixture provides the severity
// derivations; the findings carry high confidence at every severity.
const fixture = join(ROOT, "test", "fixtures", "calibration", "synthetic");
const ctx = loadAdrLog(fixture);
const adrsByFileName = new Map(ctx.adrs.map((a) => [a.fileName, a]));
const mk = (document, confidence, tag) => ({
  check: "S1",
  claim: `repro: ${tag}`,
  citations: [{ document, quote: "q" }],
  consequence: "c",
  reportedConfidence: confidence,
});
const findings = [
  mk("0001-critical-decision.md", 0.99, "critical"),
  mk("0002-elevated-decision.md", 0.99, "elevated"),
  mk("0003-routine-default.md", 0.99, "routine"),
  mk("0004-cosmetic-note.md", 0.99, "cosmetic"),
];

const tmp = mkdtempSync(join(tmpdir(), "duckadrift-interrupt-repro-"));
const KEY = { backend: "api", model: "claude-sonnet-5", effort: "high" };
const consumption = consumeCalibration(tmp, KEY, join(ROOT, "calibration.json"));
if (!consumption.calibrated || consumption.source !== "shipped") {
  fail(`expected the shipped calibration to answer; got ${JSON.stringify(consumption)}`);
}
const dispositions = routeFindings(findings, adrsByFileName, consumption);
if (!dispositions.every((d) => d.disposition === "annex")) {
  fail(`the shipped calibration routed an interrupt: ${JSON.stringify(dispositions)}`);
}

const tier1 = withTier1Run(
  { enabled: true, status: "eligible", signals: [] },
  { findings, discarded: [], droppedCitations: [], livePremises: [], skipped: [], errors: [], usage: [] },
  consumption,
  dispositions
);
const report = buildJsonReport([], "docs/adr", [], tier1);
const reportPath = join(tmp, "report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

// Run the wrapper with a PATH carrying ONLY node's directory — no gh anywhere.
// Any gh invocation would ENOENT and exit non-zero.
const nodeDir = dirname(process.execPath);
const result = spawnSync(process.execPath, [join(ROOT, "action", "emit-interrupts.mjs"), reportPath, "pr", "1"], {
  encoding: "utf-8",
  env: { PATH: nodeDir, Path: nodeDir },
});

if (result.status !== 0) {
  fail(`emit-interrupts exited ${result.status} — it attempted a post (or crashed): ${result.stderr}`);
}
if (!result.stdout.includes("0 interrupt(s)")) {
  fail(`expected the zero-interrupt line, got: ${result.stdout}`);
}
console.log("REPRO PASSED: under the shipped calibration, emit-interrupts posted nothing (gh absent from PATH, clean exit).");
console.log(`  wrapper stdout: ${result.stdout.trim()}`);
