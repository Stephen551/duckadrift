import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAdrLog } from "../adr/load.js";
import { SetupError } from "../errors.js";
import { deriveFindingSeverity } from "../tier1/calibration/severity.js";
import {
  assembleCalibrationEntry,
  generateReview,
  parseReview,
  ReviewParseError,
  type ReviewFinding,
} from "../tier1/calibration/review.js";
import type { CalibrationEntry, CalibrationFile } from "../tier1/calibration/schema.js";
import { serializeCalibration } from "../tier1/calibration/schema.js";
import { TIER1_CHECKS } from "../tier1/checks.js";
import type { ParsedAdr } from "../adr/types.js";
import { loadRecording } from "../tier1/recording.js";
import { runTier1Checks } from "../tier1/runner.js";
import { replayTransport } from "../tier1/transport.js";

// The calibration CLI (ADR-0038). Two subcommands, both OFF every verdict path
// and both network-free by construction: `generate` replays committed
// recordings (never calls the model — it reuses the ADR-0028 replay transport,
// so a stale recording throws instead of a live call) to emit the labeling
// review file; `fit` reads the human-labeled review and computes calibration.json.
// No ANTHROPIC_API_KEY is read in either path. Thresholds are computed, never
// typed (the only typed numbers are the §2.5 floors in schema.ts).

/** `duckadrift calibrate <generate|fit> …` — dispatches to the two subcommands. */
export async function executeCalibrate(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "generate":
      return executeGenerate(rest);
    case "fit":
      return executeFit(rest);
    default:
      console.error(
        "duckadrift calibrate: expected a subcommand — `generate <recordings-dir> --adr-root <p> --out <review.md>` or `fit <review.md> --key backend=api,model=…,effort=… --out <calibration.json>`."
      );
      return 2;
  }
}

/**
 * `calibrate generate <recordings-dir> --adr-root <p> --out <review.md> [--pr-context <f>] [--adr-dir <p>]`
 * Replays every committed recording in the directory through the production
 * extraction (runTier1Checks over replayTransport — zero live calls), derives
 * each surviving finding's severity from the ADR log, and writes the ordered
 * labeling review. A stale recording throws the ADR-0028 error naming the check,
 * never a silent skip. Exit: 0 wrote the review, 1 a replay/read failure, 2 setup.
 */
async function executeGenerate(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "adr-root": { type: "string" },
      out: { type: "string" },
      "pr-context": { type: "string" },
      "adr-dir": { type: "string" },
    },
    allowPositionals: true,
  });

  const recordingsDir = positionals[0];
  const adrRoot = values["adr-root"];
  const out = values.out;
  if (recordingsDir === undefined || adrRoot === undefined || out === undefined) {
    console.error(
      "duckadrift calibrate generate: <recordings-dir>, --adr-root <p>, and --out <review.md> are required."
    );
    return 2;
  }

  const dir = resolve(recordingsDir);
  const reviewPath = resolve(out);

  try {
    const ctx = loadAdrLog(resolve(adrRoot), values["pr-context"], values["adr-dir"]);
    const adrsByFileName = new Map<string, ParsedAdr>(ctx.adrs.map((a) => [a.fileName, a]));

    // Deterministic recording order so the same dir yields the same review file
    // byte-for-byte (the ordering inside review.ts is the final say; sorting the
    // paths first just makes the pre-order stable too).
    const recordingFiles = readdirSync(dir)
      .filter((f) => /\.recording\.json$/i.test(f))
      .sort();
    if (recordingFiles.length === 0) {
      console.error(`duckadrift calibrate generate: no *.recording.json files under ${dir}.`);
      return 1;
    }

    const reviewFindings: ReviewFinding[] = [];
    for (const file of recordingFiles) {
      const recordingPath = join(dir, file);
      const checkId = loadRecording(recordingPath).key.checkId;
      const check = TIER1_CHECKS.find((c) => c.id === checkId);
      if (check === undefined) {
        console.error(
          `duckadrift calibrate generate: recording ${file} names check ${JSON.stringify(checkId)}, not in this build — re-record or remove.`
        );
        return 1;
      }
      // Reuse the ONE runner: same selectInput → buildRequest → replay →
      // validateCitations → S5 confirmation the report path runs. Replay refuses
      // on a stale recording (ADR-0028); no model call happens here.
      const runResult = await runTier1Checks(ctx, [check], replayTransport(recordingPath));
      if (runResult.errors.length > 0) {
        const first = runResult.errors[0]!;
        console.error(
          `duckadrift calibrate generate: ${file} (${first.check}) failed extraction — ${first.message}`
        );
        return 1;
      }
      runResult.findings.forEach((finding, index) => {
        reviewFindings.push({
          check: finding.check,
          severity: deriveFindingSeverity(finding, adrsByFileName),
          confidence: finding.reportedConfidence,
          claim: finding.claim,
          citations: finding.citations.map((c) => ({ quote: c.quote, document: c.document })),
          source: { recordingPath: file, findingIndex: index },
        });
      });
    }

    if (reviewFindings.length === 0) {
      console.error(
        "duckadrift calibrate generate: recordings replayed clean but surfaced no findings — nothing to label. A review with zero findings would calibrate nothing (report the empty corpus loudly rather than write a hollow file)."
      );
      return 1;
    }

    mkdirSync(dirname(reviewPath), { recursive: true });
    writeFileSync(reviewPath, generateReview(reviewFindings, new Date().toISOString()), "utf-8");
    console.log(
      `duckadrift calibrate generate: ${reviewFindings.length} finding(s) → ${reviewPath}. Label each true/false, then run \`calibrate fit\`.`
    );
    return 0;
  } catch (err) {
    if (err instanceof SetupError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Loud, never silent (the Pact): a stale recording or unreadable dir fails
    // the whole generate, naming the cause — no partial review file is written.
    console.error(`duckadrift calibrate generate: FAILED — ${message}`);
    return 1;
  }
}

/** Parses `backend=api,model=…,effort=…` into the recording/calibration key — every part required, none defaulted. */
function parseKey(raw: string): CalibrationEntry["key"] {
  const parts = new Map<string, string>();
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`malformed --key segment ${JSON.stringify(pair)} (expected name=value)`);
    parts.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const backend = parts.get("backend");
  const model = parts.get("model");
  const effort = parts.get("effort");
  if (backend !== "api" && backend !== "claude-code") {
    throw new Error(`--key backend must be "api" or "claude-code", got ${JSON.stringify(backend)}`);
  }
  if (model === undefined || model === "") throw new Error("--key model is required");
  if (effort === undefined || effort === "") throw new Error("--key effort is required");
  return { backend, model, effort };
}

/** Loads an existing calibration.json to upsert into, or an empty file — strict about the schema it reads. */
function loadCalibrationFile(path: string): CalibrationFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { schemaVersion: 1, entries: [] };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).schemaVersion !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error(
      `${path} exists but is not a schemaVersion 1 calibration file — refusing to overwrite an artifact I cannot read`
    );
  }
  return parsed as CalibrationFile;
}

function sameKey(a: CalibrationEntry["key"], b: CalibrationEntry["key"]): boolean {
  return a.backend === b.backend && a.model === b.model && a.effort === b.effort;
}

/**
 * `calibrate fit <review.md> --key backend=api,model=…,effort=… --out <calibration.json>`
 * Reads the human-labeled review (refusal-first — any bad label fails the whole
 * read), computes every severity threshold on the Wilson lower bound, and
 * upserts the entry into calibration.json. Byte-stable output. Exit: 0 wrote,
 * 1 a bad review or unreadable existing file, 2 a missing flag.
 */
async function executeFit(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      key: { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: true,
  });

  const reviewPath = positionals[0];
  const keyRaw = values.key;
  const out = values.out;
  if (reviewPath === undefined || keyRaw === undefined || out === undefined) {
    console.error(
      "duckadrift calibrate fit: <review.md>, --key backend=api,model=…,effort=…, and --out <calibration.json> are required."
    );
    return 2;
  }

  const outPath = resolve(out);
  try {
    const key = parseKey(keyRaw);
    const labeled = parseReview(readFileSync(resolve(reviewPath), "utf-8"));
    const entry = assembleCalibrationEntry(labeled, key, new Date().toISOString());

    const file = loadCalibrationFile(outPath);
    const others = file.entries.filter((e) => !sameKey(e.key, key));
    const merged: CalibrationEntry[] = [...others, entry].sort((a, b) =>
      JSON.stringify(a.key).localeCompare(JSON.stringify(b.key))
    );

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serializeCalibration({ schemaVersion: 1, entries: merged }), "utf-8");

    const openable = (["critical", "elevated", "routine"] as const).filter(
      (s) => entry.perSeverity[s].threshold !== null
    );
    console.log(
      `duckadrift calibrate fit: ${labeled.length} labeled finding(s) → ${outPath} (${basename(outPath)}). Channels open: ${openable.length === 0 ? "none — corpus too small to clear any floor (a correct outcome; grow the corpus)" : openable.join(", ")}.`
    );
    return 0;
  } catch (err) {
    if (err instanceof SetupError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const label = err instanceof ReviewParseError ? "review rejected" : "FAILED";
    console.error(`duckadrift calibrate fit: ${label} — ${message}`);
    return 1;
  }
}
