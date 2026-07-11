import { createHash } from "node:crypto";
import { fitSeverity } from "./curve.js";
import {
  SEVERITY_FLOORS,
  type CalibrationEntry,
  type InterruptSeverity,
  type Severity,
} from "./schema.js";

// The labeling review file (ADR-0038). The labels are the moat, so the harness
// refuses to guess them: generation emits one deterministic markdown file with
// a `label: ____` slot per finding, and parsing is refusal-first — a label is
// exactly `true` or `false`, and a missing, malformed, ambiguous, or
// count-mismatched label fails the ENTIRE read. No finding is ever silently
// skipped or defaulted into the curve.

export interface ReviewFinding {
  check: string; // "S1".."S5"
  severity: Severity; // derived (severity.ts), shown for transparency, not editable
  confidence: number;
  claim: string;
  citations: Array<{ quote: string; document: string }>;
  /** Deterministic ordering source — recording path then finding index within it. */
  source: { recordingPath: string; findingIndex: number };
}

export interface LabeledReviewFinding {
  check: string;
  severity: Severity;
  confidence: number;
  label: boolean;
}

/** Deterministic order: by check, then recording path, then finding index — stable across runs so the review file lives in git. */
export function orderReviewFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => {
    if (a.check !== b.check) return a.check < b.check ? -1 : 1;
    if (a.source.recordingPath !== b.source.recordingPath) {
      return a.source.recordingPath < b.source.recordingPath ? -1 : 1;
    }
    return a.source.findingIndex - b.source.findingIndex;
  });
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** One display line per field — a claim or quote that spans lines is flattened to spaces so it never leaks into the next parseable line. The label and confidence the parser reads are unaffected; this only touches human-facing text. */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, " ").trim();
}

/** Emits the review markdown. `label: ____` is the unfilled slot the human replaces with `true` or `false`. */
export function generateReview(findings: readonly ReviewFinding[], generatedAt: string): string {
  const ordered = orderReviewFindings(findings);
  const shortHash = corpusHashUnlabeled(ordered).slice(0, 12);
  const lines: string[] = [
    `# duckadrift calibration review — generated ${generatedAt}, corpus ${shortHash}`,
    "",
    `${ordered.length} finding(s). Replace each blank label slot with exactly \`true\` or \`false\` (case-sensitive).`,
    "",
  ];
  ordered.forEach((f, i) => {
    lines.push(`## finding ${pad3(i + 1)}`);
    lines.push(`check: ${f.check}`);
    lines.push(`severity: ${f.severity}`);
    lines.push(`confidence: ${f.confidence}`);
    lines.push(`claim: ${oneLine(f.claim)}`);
    lines.push("evidence:");
    for (const c of f.citations) lines.push(`> ${oneLine(c.quote)} — ${c.document}`);
    lines.push("label: ____");
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

export class ReviewParseError extends Error {}

const HEADING_RE = /^## finding (\d+)\s*$/;
const CHECK_RE = /^check: (\S.*)$/;
const SEVERITY_RE = /^severity: (critical|elevated|routine|cosmetic)\s*$/;
const CONFIDENCE_RE = /^confidence: (.+)$/;
const LABEL_RE = /^label: (.*)$/;

/**
 * Strict, refusal-first parse (the ADR-0028 ethos applied to labels). Every
 * finding block must carry a valid check, severity, numeric confidence, and a
 * label that is EXACTLY `true` or `false`. Any deviation — a `____` slot, a
 * blank, `TRUE`, a missing line, a duplicated id, a non-sequential id — throws
 * and fails the whole read. An unlabeled finding never slides into the curve.
 */
export function parseReview(markdown: string): LabeledReviewFinding[] {
  const lines = markdown.split(/\r?\n/);
  const out: LabeledReviewFinding[] = [];
  let i = 0;
  let expectedId = 1;

  // Skip to the first finding heading.
  while (i < lines.length && !HEADING_RE.test(lines[i]!)) i++;

  while (i < lines.length) {
    const headingMatch = HEADING_RE.exec(lines[i]!);
    if (!headingMatch) {
      i++;
      continue;
    }
    const id = Number.parseInt(headingMatch[1]!, 10);
    if (id !== expectedId) {
      throw new ReviewParseError(
        `finding ids must be sequential from 001; expected ${expectedId}, found ${id}`
      );
    }
    expectedId++;

    // Collect the block's field lines until the next heading or EOF.
    const fields = new Map<string, string>();
    let sawLabel = false;
    let labelRaw = "";
    i++;
    for (; i < lines.length && !HEADING_RE.test(lines[i]!); i++) {
      const line = lines[i]!;
      const labelMatch = LABEL_RE.exec(line);
      if (labelMatch) {
        if (sawLabel) throw new ReviewParseError(`finding ${id}: duplicate label line`);
        sawLabel = true;
        labelRaw = labelMatch[1]!;
        continue;
      }
      const check = CHECK_RE.exec(line);
      if (check) fields.set("check", check[1]!.trim());
      const conf = CONFIDENCE_RE.exec(line);
      if (conf) fields.set("confidence", conf[1]!.trim());
      const sev = SEVERITY_RE.exec(line);
      if (sev) fields.set("severity", sev[1]!);
      else if (/^severity: /.test(line)) {
        throw new ReviewParseError(`finding ${id}: unrecognized severity ${JSON.stringify(line.slice("severity: ".length))}`);
      }
    }

    if (!sawLabel) throw new ReviewParseError(`finding ${id}: no label line`);
    // Case-sensitive, exact — no coercion. `____`, blank, TRUE, maybe all fail.
    if (labelRaw !== "true" && labelRaw !== "false") {
      throw new ReviewParseError(
        `finding ${id}: label must be exactly "true" or "false", got ${JSON.stringify(labelRaw)}`
      );
    }
    const check = fields.get("check");
    const severity = fields.get("severity");
    const confidenceRaw = fields.get("confidence");
    if (check === undefined) throw new ReviewParseError(`finding ${id}: missing check`);
    if (severity === undefined) throw new ReviewParseError(`finding ${id}: missing severity`);
    if (confidenceRaw === undefined) throw new ReviewParseError(`finding ${id}: missing confidence`);
    const confidence = Number(confidenceRaw);
    if (!Number.isFinite(confidence)) {
      throw new ReviewParseError(`finding ${id}: confidence is not a number: ${JSON.stringify(confidenceRaw)}`);
    }

    out.push({ check, severity: severity as Severity, confidence, label: labelRaw === "true" });
  }

  if (out.length === 0) throw new ReviewParseError("review file contains no findings");
  return out;
}

/** Canonical serialization of a labeled corpus (sorted, stable) → sha256. The hash the CalibrationEntry traces to. */
export function corpusHash(labeled: readonly LabeledReviewFinding[]): string {
  const canonical = [...labeled]
    .map((f) => ({ check: f.check, severity: f.severity, confidence: f.confidence, label: f.label }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(canonical), "utf-8").digest("hex");
}

const INTERRUPT_SEVERITIES: InterruptSeverity[] = ["critical", "elevated", "routine"];

/**
 * Assembles a CalibrationEntry from a labeled corpus. Each interrupting severity
 * is fitted against its own §2.5 floor over its own labeled findings; cosmetic
 * findings count toward the entry's total sampleSize but never form a severity
 * channel (they cannot interrupt). Every threshold in the result is computed by
 * fitSeverity — none is typed. The corpusHash traces the entry back to the exact
 * labeled set that produced it.
 */
export function assembleCalibrationEntry(
  labeled: readonly LabeledReviewFinding[],
  key: CalibrationEntry["key"],
  generatedAt: string
): CalibrationEntry {
  const perSeverity = {} as CalibrationEntry["perSeverity"];
  for (const severity of INTERRUPT_SEVERITIES) {
    const cohort = labeled
      .filter((f) => f.severity === severity)
      .map((f) => ({ confidence: f.confidence, label: f.label }));
    perSeverity[severity] = fitSeverity(cohort, SEVERITY_FLOORS[severity]);
  }
  return {
    key,
    corpusHash: corpusHash(labeled),
    sampleSize: labeled.length,
    generatedAt,
    perSeverity,
  };
}

/** The unlabeled corpus hash (for the review file header) — same canonicalization minus the label. */
function corpusHashUnlabeled(findings: readonly ReviewFinding[]): string {
  const canonical = [...findings]
    .map((f) => ({ check: f.check, severity: f.severity, confidence: f.confidence, claim: f.claim }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(canonical), "utf-8").digest("hex");
}
