import { TIER_ZERO_CHECK_IDS } from "../types.js";
import type { Finding, FindingEvidence, TierZeroCheckId } from "../types.js";

const CHECK_TITLES: Record<TierZeroCheckId, string> = {
  D1: "Schema/structure lint",
  D2: "Status-graph integrity",
  D3: "Reference integrity",
  D4: "Ghost references",
  D5: "Governed-path gate",
  D6: "Staleness clock",
  D7: "Log/index drift",
};

function findingSortKey(f: Finding): string {
  const ev = f.evidence[0];
  const evKey = ev ? `${ev.adr ?? ""}|${ev.file ?? ""}|${ev.line ?? 0}` : "";
  return `${f.check}|${evKey}|${f.claim}`;
}

/** Stable, content-only ordering (no wall-clock) — required for byte-identical reports (PDR §3.2). */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => findingSortKey(a).localeCompare(findingSortKey(b)));
}

/**
 * Wraps a user-controlled value in a Markdown code span it cannot break out of
 * (S3, ADR-0013). The report is piped verbatim into the job summary and the
 * schedule-mode issue body; before this, a backtick inside a filename or a D3
 * link target closed the code span and the rest of the value rendered as live
 * Markdown — autolinks, @mentions, raw HTML. A fence one backtick longer than
 * the longest run inside the value keeps every inner backtick literal; padding
 * spaces stop a leading or trailing backtick from touching the fence. Content
 * inside a code span renders literally, so HTML and autolinks stay inert. A
 * value with no backticks produces exactly `` `value` ``, unchanged.
 */
export function code(value: string): string {
  const s = String(value);
  let longest = 0;
  let run = 0;
  for (const ch of s) {
    if (ch === "`") {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  const fence = "`".repeat(longest + 1);
  const pad = s.length === 0 || s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

function renderEvidence(ev: FindingEvidence): string {
  if (ev.adr) return code(ev.adr);
  if (ev.file) return ev.line !== undefined ? code(`${ev.file}:${ev.line}`) : code(ev.file);
  return "(unspecified)";
}

export function renderMarkdownReport(findings: Finding[], unrecognizedFiles: string[] = []): string {
  const sorted = sortFindings(findings);
  const failing = sorted.filter((f) => !f.advisory).length;
  const advisory = sorted.length - failing;
  const lines: string[] = ["# duckadrift report", ""];

  lines.push(`Tier 0 findings: ${sorted.length} (${failing} failing, ${advisory} advisory)`);
  lines.push("Tier 1: not run (M1 scope)");
  lines.push("", "## Tier 0 findings", "");

  if (sorted.length === 0) {
    lines.push("No Tier 0 findings.", "");
  } else {
    for (const checkId of TIER_ZERO_CHECK_IDS) {
      const group = sorted.filter((f) => f.check === checkId);
      if (group.length === 0) continue;
      lines.push(`### ${checkId} — ${CHECK_TITLES[checkId]} (${group.length})`, "");
      for (const f of group) {
        lines.push(`- ${f.advisory ? "[advisory] " : ""}${f.claim}`);
        lines.push(`  - Evidence: ${f.evidence.map(renderEvidence).join(", ")}`);
        lines.push(`  - Consequence: ${f.consequence}`);
      }
      lines.push("");
    }
  }

  // Always present (ADR-0007) — silent partial coverage violates the Pact
  // regardless of cause. Unconditional, so the absence of anything to
  // report is stated, never merely implied by an omitted section.
  lines.push("## Coverage", "");
  if (unrecognizedFiles.length === 0) {
    lines.push("Every markdown file found under the ADR root was recognized as an ADR or the index.", "");
  } else {
    lines.push(
      `${unrecognizedFiles.length} file(s) found under the ADR root that are neither the index nor ` +
        "recognized as an ADR — verify none of these is a real decision this tool's naming heuristic missed:",
      ""
    );
    for (const f of unrecognizedFiles) lines.push(`- ${code(f)}`);
    lines.push("");
  }

  lines.push(
    "## Calibration status",
    "",
    "Tier 1 semantic checks are not part of this build (M1). Calibration status appears here starting at M3.",
    ""
  );

  return lines.join("\n");
}

export interface JsonReport {
  tier0Findings: Finding[];
  tier1: null;
  checkCounts: Record<TierZeroCheckId, number>;
  failingCount: number;
  advisoryCount: number;
  /** ADR directory, relative to repo root (e.g. "docs/adr") — lets consumers turn evidence.adr (a bare filename) into a path GitHub can annotate. */
  adrDirRelative: string;
  /** Repo-root-relative paths under the ADR root that are neither the index nor a recognized ADR (ADR-0007). Always present, empty when clean. */
  unrecognizedFiles: string[];
  /** True only on an error report: the scan threw before completing (ADR-0013). Absent on every normal report. */
  incomplete?: true;
  /** The error message, present only on an error report. */
  error?: string;
}

/**
 * The report written when the scan itself throws before it can complete
 * (ADR-0013, the silent-green fix). `failingCount` is 1 by construction: an
 * incomplete scan is a failure, never a clean pass the tool cannot stand
 * behind. The Action reads `failingCount` and goes red; `tier0Findings` is
 * empty so the annotation path emits nothing spurious. The watch may fail;
 * it never stands down silently and green (the Pact).
 */
export function buildErrorReport(message: string): { markdown: string; json: JsonReport } {
  // The message can carry user-controlled fragments (a filename, a link
  // target). Neutralize backticks so the error markdown can't itself become
  // the injection surface S3 closes elsewhere.
  const safe = message.replace(/`/g, "'").replace(/\r?\n/g, " ").trim();
  const checkCounts = Object.fromEntries(TIER_ZERO_CHECK_IDS.map((id) => [id, 0])) as Record<
    TierZeroCheckId,
    number
  >;
  const json: JsonReport = {
    tier0Findings: [],
    tier1: null,
    checkCounts,
    failingCount: 1,
    advisoryCount: 0,
    adrDirRelative: "",
    unrecognizedFiles: [],
    incomplete: true,
    error: safe,
  };
  const markdown = [
    "# duckadrift report",
    "",
    "Tier 0: scan did not complete",
    "Tier 1: not run (M1 scope)",
    "",
    "## Scan failed",
    "",
    "duckadrift did not finish scanning this repository. It is failing the check",
    "rather than reporting a clean pass it cannot stand behind — an incomplete",
    "scan is never a silent green (the Pact).",
    "",
    `Error: ${safe}`,
    "",
  ].join("\n");
  return { markdown, json };
}

export function buildJsonReport(
  findings: Finding[],
  adrDirRelative: string,
  unrecognizedFiles: string[] = []
): JsonReport {
  const sorted = sortFindings(findings);
  const checkCounts = Object.fromEntries(TIER_ZERO_CHECK_IDS.map((id) => [id, 0])) as Record<
    TierZeroCheckId,
    number
  >;
  for (const f of sorted) checkCounts[f.check]++;
  const advisoryCount = sorted.filter((f) => f.advisory).length;
  return {
    tier0Findings: sorted,
    tier1: null,
    checkCounts,
    failingCount: sorted.length - advisoryCount,
    advisoryCount,
    adrDirRelative,
    unrecognizedFiles,
  };
}
