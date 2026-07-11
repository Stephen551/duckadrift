#!/usr/bin/env node
// M4.3 corpus-scale review generation. Emits exactly two labeling files:
//   calibration-corpus/REVIEW-public.md            (committed; public text only)
//   calibration-corpus/private/REVIEW-private.md   (local-only, gitignored side)
//
// Findings enter ONLY through the production replay pipeline — the corrected
// counting pass: full trees at the recorded SHAs, guarded worktrees for diff
// candidates (SHA mismatch refuses), runTier1Checks over replayTransport, so
// citation validation and S5 dead-premise confirmation run exactly as the
// report path runs them. If the accepted totals differ from the yield tables
// (27 whole-log + 28 diff = 55), this script REFUSES to write and routes —
// the corpus is the fact; generation must reproduce it.
//
// $0 — replay only; no API key read anywhere on this path.
//
// Usage: node scripts/generate-corpus-review.mjs --manifest <m.json> --harvest <h.json>

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DIST = resolve("dist");
const { loadAdrLog } = await import(pathToFileURL(join(DIST, "adr/load.js")));
const { runTier1Checks } = await import(pathToFileURL(join(DIST, "tier1/runner.js")));
const { replayTransport } = await import(pathToFileURL(join(DIST, "tier1/transport.js")));
const { TIER1_CHECKS } = await import(pathToFileURL(join(DIST, "tier1/checks.js")));
const { loadRecording } = await import(pathToFileURL(join(DIST, "tier1/recording.js")));
const { generateReview } = await import(pathToFileURL(join(DIST, "tier1/calibration/review.js")));
const { deriveFindingSeverity } = await import(pathToFileURL(join(DIST, "tier1/calibration/severity.js")));
const { confirmDeadPremise, referentAbsent } = await import(pathToFileURL(join(DIST, "tier1/confirm-premise.js")));

// wholeLog is 28, not the yield table's original 27: the director's M4.3 ruling
// fixed the S5 confirmation context as the COMMITTED tree at the captured SHA
// (guarded worktree — reproducible from git, and mirrors production CI
// checkouts, which don't carry untracked artifacts either). Under that context
// first-internal-log S5 accepts 22 (one premise — ADR-0045's ONNX artifacts —
// is untracked-alive on the live disk but absent from the commit). YIELD.md
// carries the correction note.
const EXPECTED = { wholeLog: 28, diff: 28 };
const WT = "C:/Users/steph/AppData/Local/Temp/wt";

// The director's labeling rubric (M4.3 Part 3) — ships in the artifact so the
// labels stay consistent without leaving the file.
const RUBRIC = `## Labeling rubric (read before labeling; the labels are the moat)

- **S1 (contradiction):** TRUE if the two cited records, read as written, genuinely commit
  to incompatible things a maintainer would have to reconcile. Not a contradiction:
  scope-split decisions, one record refining another, or rhetorical tension.
- **S4 (recurring revision):** TRUE if the cited records revisit the same underlying
  decision (same subject circling) such that a maintainer should consolidate or supersede.
  Not recurring: a sequence that is genuine forward evolution with each step superseding
  cleanly.
- **S5 (dead premise, private side only):** TRUE if the premise the finding quotes is, in
  YOUR tree today, genuinely gone (the named dependency absent from every manifest, the
  path absent from disk). You are the final audit on the deterministic confirmation —
  check the tree, not your recollection.
- **S3 (unrecorded decision):** TRUE if the changed manifest/schema content the finding
  cites embodies an architectural decision (a new dependency direction, a storage shape,
  a framework commitment) that a decision-record-keeping team should have recorded at
  that commit — judged at that commit, not with hindsight. FALSE for routine version
  bumps, lockfile churn, or mechanical renames.

Label format is strict: exactly \`label: true\` or \`label: false\`, every entry, no
defaults. The parser refuses anything else — that refusal is the corpus's integrity,
not an inconvenience.`;

const git = (cwd, a) => execFileSync("git", a, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    harvest: { type: "string" },
    // --only private regenerates ONLY the private file (e.g. adding S5 machine
    // annotations without touching the committed REVIEW-public.md's bytes).
    only: { type: "string" },
    // --stamp pins the header timestamp for a targeted regeneration.
    stamp: { type: "string" },
  },
});
if (!values.manifest || !values.harvest) {
  console.error("generate-corpus-review: --manifest and --harvest are required.");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf-8"));
const harvest = JSON.parse(readFileSync(resolve(values.harvest), "utf-8"));
mkdirSync(WT, { recursive: true });

/** Replays one recording in a prepared ctx and returns ReviewFinding[] for its accepted findings. `annotate(finding)` may return machine-note strings (M4.3: private S5 only). */
async function replayToReviewFindings(ctx, recordingPath, relPath, repoLabel, sourceKind, adrsByFileName, annotate) {
  const checkId = loadRecording(recordingPath).key.checkId;
  const check = TIER1_CHECKS.find((c) => c.id === checkId);
  const r = await runTier1Checks(ctx, [check], replayTransport(recordingPath));
  if (r.errors.length > 0) {
    throw new Error(`${relPath} (${checkId}): ${r.errors[0].message}`);
  }
  return r.findings.map((finding, index) => ({
    check: finding.check,
    severity: deriveFindingSeverity(finding, adrsByFileName),
    confidence: finding.reportedConfidence,
    claim: finding.claim,
    citations: finding.citations.map((c) => ({ quote: c.quote, document: c.document })),
    source: { recordingPath: relPath, findingIndex: index },
    repo: repoLabel,
    sourceKind,
    ...(annotate ? { machineNotes: annotate(finding) } : {}),
  }));
}

/**
 * The S5 machine annotation (M4.3): the same existence logic the deterministic
 * confirmation runs, probed against BOTH trees, so the director's S5 pass is
 * agree/override rather than filesystem work. A referent PRESENT on the live
 * disk (the untracked-artifact class) is flagged loudly — likely label: false.
 * Human ground-truth checks (S1/S3/S4) are never annotated.
 */
function s5MachineAnnotator(committedCtx, sha12, liveRoot) {
  return (finding) => {
    const verdict = confirmDeadPremise(finding, committedCtx);
    if (!verdict.dead) {
      // Unreachable for an accepted S5 finding; if it happens, say so rather than guess.
      return [`confirmation disagreed on re-run (${verdict.reason}) — treat manually`];
    }
    const { kind, value } = verdict.referent;
    const absentLive = referentAbsent(verdict.referent, liveRoot);
    const liveDesc =
      kind === "path"
        ? `${absentLive ? "absent" : "PRESENT"} on live disk at ${liveRoot}/${value}`
        : `${absentLive ? "absent from every package.json manifest" : "PRESENT in a package.json manifest"} on live disk at ${liveRoot}`;
    const loud = absentLive ? "" : " ⚠ VERIFY — likely label: false (untracked-artifact class)";
    return [`${value} (${kind}) — absent from committed tree @ ${sha12}; ${liveDesc}${loud}`];
  };
}

const bySide = { public: [], private: [] };
let wholeLogAccepted = 0;
let diffAccepted = 0;

for (const spec of manifest) {
  const root = resolve(spec.root);
  const repoDir = resolve("calibration-corpus", spec.side, spec.label);
  if (!existsSync(repoDir)) continue;

  // Whole-log recordings: ctx from the repo's FULL tree AT THE CAPTURED SHA,
  // reconstructed in a guarded worktree. This matters even for duckadrift
  // itself: its log has grown since capture (ADR-0041 landed), and replaying
  // against today's tree would change the promptHash — the ADR-0028 stale
  // refusal firing correctly. The recording's truth lives at the captured SHA.
  const wholeLogRecordings = readdirSync(repoDir).filter((f) => /\.recording\.json$/i.test(f)).sort();
  if (wholeLogRecordings.length > 0) {
    if (!spec.capturedHead) {
      console.error(`${spec.label}: no capturedHead in the manifest — cannot guard the whole-log tree. REFUSING.`);
      process.exit(1);
    }
    const fullSha = git(root, ["rev-parse", spec.capturedHead]).trim();
    const wt = join(WT, `${spec.label}-wholelog`);
    try {
      if (!existsSync(wt)) git(root, ["worktree", "add", "--detach", "--force", wt, fullSha]);
      const at = git(wt, ["rev-parse", "HEAD"]).trim();
      if (at !== fullSha) throw new Error(`worktree at ${at.slice(0, 12)}, captured at ${spec.capturedHead} — refusing`);
      const ctx = loadAdrLog(wt, undefined, spec.adrDir ?? undefined);
      const adrsByFileName = new Map(ctx.adrs.map((a) => [a.fileName, a]));
      for (const f of wholeLogRecordings) {
        // Private S5 gets the machine annotation; S1/S3/S4 stay unassisted
        // (human ground truth by design), as does the public side (no S5
        // findings exist there, and the rule is check-scoped anyway).
        const isS5 = /(^|\/)s5\.recording\.json$/i.test(f);
        const annotate =
          spec.side === "private" && isS5
            ? s5MachineAnnotator(ctx, spec.capturedHead, resolve(spec.root))
            : undefined;
        const found = await replayToReviewFindings(
          ctx, join(repoDir, f), `${spec.side}/${spec.label}/${f}`, spec.label, "whole-log", adrsByFileName, annotate
        );
        wholeLogAccepted += found.length;
        bySide[spec.side].push(...found);
      }
    } finally {
      try { git(root, ["worktree", "remove", "--force", wt]); } catch { /* pruned next run */ }
    }
  }

  // Diff recordings: guarded worktree per candidate, prContext vs first parent.
  const diffsDir = join(repoDir, "diffs");
  if (existsSync(diffsDir)) {
    const repoHarvest = harvest.find((h) => h.label === spec.label);
    for (const sha12 of readdirSync(diffsDir).sort()) {
      const fullSha = git(root, ["rev-parse", sha12]).trim();
      const wt = join(WT, `${spec.label}-${sha12}`);
      try {
        if (!existsSync(wt)) git(root, ["worktree", "add", "--detach", "--force", wt, fullSha]);
        const at = git(wt, ["rev-parse", "HEAD"]).trim();
        if (at !== fullSha) throw new Error(`worktree at ${at.slice(0, 12)} != ${sha12} — refusing`);
        const changed = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", `${fullSha}^1`, fullSha])
          .split("\n").filter(Boolean);
        const prPath = join(WT, `pr-${spec.label}-${sha12}.json`);
        writeFileSync(prPath, JSON.stringify({ changedFiles: changed }), "utf-8");
        const ctx = loadAdrLog(wt, prPath, repoHarvest?.adrDir ?? spec.adrDir ?? undefined);
        const adrsByFileName = new Map(ctx.adrs.map((a) => [a.fileName, a]));
        for (const f of readdirSync(join(diffsDir, sha12)).filter((f) => /\.recording\.json$/i.test(f)).sort()) {
          const found = await replayToReviewFindings(
            ctx, join(diffsDir, sha12, f), `${spec.side}/${spec.label}/diffs/${sha12}/${f}`,
            spec.label, `diff ${sha12}`, adrsByFileName
          );
          diffAccepted += found.length;
          bySide[spec.side].push(...found);
        }
      } finally {
        try { git(root, ["worktree", "remove", "--force", wt]); } catch { /* pruned next run */ }
      }
    }
  }
}

// The reproduction gate: generation must land on the yield tables' totals
// exactly, or the corpus and the generator disagree and the disagreement is
// the finding — refuse and route, never write a drifted review.
if (wholeLogAccepted !== EXPECTED.wholeLog || diffAccepted !== EXPECTED.diff) {
  console.error(
    `REFUSING: generation found ${wholeLogAccepted} whole-log + ${diffAccepted} diff accepted findings; the yield tables say ${EXPECTED.wholeLog} + ${EXPECTED.diff}. Route this drift — do not label a corpus that disagrees with its own record.`
  );
  process.exit(1);
}

// Corpus order (M4.3): repo, then SHA (whole-log first), then check, then index.
const corpusComparator = (a, b) => {
  if (a.repo !== b.repo) return a.repo < b.repo ? -1 : 1;
  const shaOf = (f) => (f.sourceKind.startsWith("diff ") ? f.sourceKind.slice(5) : "");
  if (shaOf(a) !== shaOf(b)) return shaOf(a) < shaOf(b) ? -1 : 1;
  if (a.check !== b.check) return a.check < b.check ? -1 : 1;
  return a.source.findingIndex - b.source.findingIndex;
};

const generatedAt = values.stamp ?? new Date().toISOString();
if (values.only === undefined || values.only === "public") {
  const publicMd = generateReview(bySide.public, generatedAt, { preamble: RUBRIC, comparator: corpusComparator });
  writeFileSync(resolve("calibration-corpus", "REVIEW-public.md"), publicMd, "utf-8");
}
if (values.only === undefined || values.only === "private") {
  const privateMd = generateReview(bySide.private, generatedAt, { preamble: RUBRIC, comparator: corpusComparator });
  mkdirSync(resolve("calibration-corpus", "private"), { recursive: true });
  writeFileSync(resolve("calibration-corpus", "private", "REVIEW-private.md"), privateMd, "utf-8");
}

console.log(
  `${values.only === "private" ? "(public untouched) " : ""}REVIEW-public: ${bySide.public.length} finding(s); REVIEW-private: ${bySide.private.length} finding(s); total ${bySide.public.length + bySide.private.length} (${wholeLogAccepted} whole-log + ${diffAccepted} diff) — matches the yield tables.`
);
