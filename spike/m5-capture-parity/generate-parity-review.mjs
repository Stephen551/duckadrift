#!/usr/bin/env node
// THROWAWAY SPIKE: M5.3 PR E parity review generation. Replays every
// *.claude-code.recording.json in the roster's out dirs through the
// PRODUCTION pipeline (runTier1Checks over replayTransport; zero live calls,
// $0), derives severities from each repo's own log, and emits TWO unlabeled
// per-tuple labeling files honoring the ADR-0040 split:
//   calibration-corpus/REVIEW-claude-code-public.md      (committed)
//   calibration-corpus/private/REVIEW-claude-code-private.md (private side)
// Labels are per-tuple and the director's alone: every slot ships unfilled.
// Where a finding byte-matches a labeled api-tuple entry (claim and evidence
// lines identical), a display-only machine note names the api ordinal and its
// label for a fast director tap; the parser reads none of it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = "C:/Users/steph/Desktop/SaaS/duckadrift";
const DIST = resolve(ROOT, "dist");
const { loadAdrLog } = await import(pathToFileURL(join(DIST, "adr/load.js")));
const { runTier1Checks } = await import(pathToFileURL(join(DIST, "tier1/runner.js")));
const { replayTransport } = await import(pathToFileURL(join(DIST, "tier1/transport.js")));
const { TIER1_CHECKS } = await import(pathToFileURL(join(DIST, "tier1/checks.js")));
const { generateReview } = await import(pathToFileURL(join(DIST, "tier1/calibration/review.js")));
const { deriveFindingSeverity } = await import(pathToFileURL(join(DIST, "tier1/calibration/severity.js")));

const rosterPath = process.argv[2];
if (rosterPath === undefined) {
  console.error("usage: node generate-parity-review.mjs <roster.json> (private side)");
  process.exit(2);
}
const roster = JSON.parse(readFileSync(rosterPath, "utf-8"));

// The labeled api reviews, parsed from their own display lines (repo, claim,
// evidence, label) for exact byte-matching. Both sides read; private text
// never leaves the private artifact because matches are cited by ordinal.
function parseLabeledDisplay(path, side) {
  if (!existsSync(path)) return [];
  const entries = [];
  let current = null;
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const heading = /^## finding (\d+)\s*$/.exec(line);
    if (heading) {
      if (current) entries.push(current);
      current = { side, ordinal: heading[1], claim: "", evidence: [], label: null };
      continue;
    }
    if (!current) continue;
    const claim = /^claim: (.*)$/.exec(line);
    if (claim) current.claim = claim[1];
    const ev = /^> (.*)$/.exec(line);
    if (ev) current.evidence.push(ev[1]);
    const label = /^label: (true|false)\s*$/.exec(line);
    if (label) current.label = label[1];
  }
  if (current) entries.push(current);
  return entries;
}

const apiEntries = [
  ...parseLabeledDisplay(resolve(ROOT, "calibration-corpus/REVIEW-public.md"), "api-public"),
  ...parseLabeledDisplay(resolve(ROOT, "calibration-corpus/private/REVIEW-private.md"), "api-private"),
];
const apiByKey = new Map();
for (const e of apiEntries) {
  apiByKey.set(JSON.stringify([e.claim, ...e.evidence]), e);
}

const oneLine = (t) => String(t).replace(/\r?\n/g, " ").trim();

const publicFindings = [];
const privateFindings = [];
const tally = [];

for (const repo of roster.repos) {
  const ctx = loadAdrLog(repo.root, undefined, repo.adrDir);
  const adrsByFileName = new Map(ctx.adrs.map((a) => [a.fileName, a]));
  const isPrivate = repo.out.includes("calibration-corpus/private");
  for (const checkId of roster.checks) {
    const recordingPath = join(repo.out, `${checkId.toLowerCase()}.claude-code.recording.json`);
    if (!existsSync(recordingPath)) {
      tally.push({ repo: repo.name, check: checkId, status: "no-recording" });
      continue;
    }
    const check = TIER1_CHECKS.find((c) => c.id === checkId);
    const run = await runTier1Checks(ctx, [check], replayTransport(recordingPath));
    tally.push({
      repo: repo.name,
      check: checkId,
      status: "replayed",
      accepted: run.findings.length,
      livePremises: run.livePremises.length,
      discarded: run.discarded.length,
      errors: run.errors.length,
    });
    run.findings.forEach((finding, findingIndex) => {
      const claimLine = oneLine(finding.claim);
      const evidenceLines = finding.citations.map((c) => `${oneLine(c.quote)} — ${c.document}`);
      const match = apiByKey.get(JSON.stringify([claimLine, ...evidenceLines]));
      const reviewFinding = {
        check: checkId,
        severity: deriveFindingSeverity(finding, adrsByFileName),
        confidence: finding.reportedConfidence,
        claim: finding.claim,
        citations: finding.citations,
        source: { recordingPath, findingIndex },
        repo: repo.name,
        sourceKind: "whole-log claude-code",
        machineNotes: match
          ? [`byte-matches ${match.side} finding ${match.ordinal} (label: ${match.label ?? "unlabeled"})`]
          : ["no byte-identical api-tuple counterpart"],
      };
      (isPrivate ? privateFindings : publicFindings).push(reviewFinding);
    });
  }
}

const RUBRIC = `## Labeling rubric (per-tuple: these labels belong to the claude-code tuple alone)

The api tuple's rubric applies verbatim (calibration-corpus/REVIEW-public.md). No api
label transfers by assumption: a byte-match machine note is a pointer for a fast tap,
never a pre-filled answer. Label format is strict: exactly \`label: true\` or
\`label: false\`, every entry, no defaults.`;

const generatedAt = new Date().toISOString();
const publicMd = generateReview(publicFindings, generatedAt, { preamble: RUBRIC });
writeFileSync(resolve(ROOT, "calibration-corpus/REVIEW-claude-code-public.md"), publicMd, "utf-8");
const privateMd = generateReview(privateFindings, generatedAt, { preamble: RUBRIC });
writeFileSync(resolve(ROOT, "calibration-corpus/private/REVIEW-claude-code-private.md"), privateMd, "utf-8");

writeFileSync(
  join(resolve(ROOT, "spike/m5-capture-parity"), "parity-tally.json"),
  JSON.stringify(tally, null, 2) + "\n"
);
console.log(
  `public findings: ${publicFindings.length}; private findings: ${privateFindings.length}; tally written`
);
for (const t of tally) {
  console.log(
    `${t.repo}/${t.check}: ${t.status}${t.status === "replayed" ? ` f=${t.accepted} lp=${t.livePremises} d=${t.discarded} e=${t.errors}` : ""}`
  );
}
