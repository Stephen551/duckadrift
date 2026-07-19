import { TIER_ZERO_CHECK_IDS } from "../types.js";
import type { Finding, FindingEvidence, TierZeroCheckId } from "../types.js";
import type { CalibrationConsumption } from "../tier1/calibration/consume.js";
import type { RoutedFinding } from "../tier1/calibration/route.js";
import type { InterruptSeverity } from "../tier1/calibration/schema.js";
import type { Tier1Signal } from "../tier1/gate.js";
import type { Tier1RunResult } from "../tier1/runner.js";

/**
 * The Tier 1 status vocabulary (ADR-0029) — the contract M3.2's pipeline
 * plugs into. Every enabled state names why Tier 1 did or did not spend;
 * skipping is always spoken (ADR-0003, PDR §2.8). When checks actually ran
 * (M3.2's runner), the run fields appear together, always labeled
 * UNCALIBRATED: findings carry model-reported confidence that is compared
 * against nothing in this codebase (PDR §2.6 — thresholds are calibration
 * artifacts, M4), and their only destination is this annex.
 */
export type Tier1Status =
  | { enabled: false }
  | {
      enabled: true;
      status: "no-credentials" | "no-signal" | "eligible";
      signals: Tier1Signal[]; // always computed in PR mode, [] otherwise
      /** On no-credentials: WHICH env var is missing, named by the transport module's backend map (ADR-0044) so the skip line says exactly what the run lacked. */
      credentialName?: string;
      /** The sweep pause block (ADR-0045 visible pause; PDR 2.8): completed and total units and the units not checked, enumerated by name. The next run restarts from the beginning (ADR-0047, no cross-run resume), so there is no resume-at estimate. */
      paused?: { completed: number; total: number; notChecked: string[] };
      findings?: Tier1RunResult["findings"];
      discarded?: Tier1RunResult["discarded"];
      droppedCitations?: Tier1RunResult["droppedCitations"];
      livePremises?: Tier1RunResult["livePremises"];
      skipped?: Tier1RunResult["skipped"];
      errors?: Tier1RunResult["errors"];
      usage?: Tier1RunResult["usage"];
      /**
       * "UNCALIBRATED": no calibration entry answered this run's tuple —
       * today's annex-only behavior, loudly labeled. A CalibrationConsumption
       * (ADR-0042): the artifact was consumed and each severity's channel
       * state is stated with its numbers.
       */
      calibration?: "UNCALIBRATED" | CalibrationConsumption;
      /** Index-aligned with `findings`: each finding's derived severity and disposition (ADR-0042). Absent on an uncalibrated run predating routing. */
      dispositions?: RoutedFinding[];
    };

/** Attaches a run's results to an enabled status — the one way run data enters a report. When consumption and routing are supplied (ADR-0042), the calibration block carries channel states; otherwise the run is labeled UNCALIBRATED exactly as before. */
export function withTier1Run(
  status: Tier1Status,
  run: Tier1RunResult,
  calibration?: CalibrationConsumption,
  dispositions?: RoutedFinding[]
): Tier1Status {
  if (!status.enabled) return status;
  return {
    ...status,
    ...run,
    calibration: calibration ?? "UNCALIBRATED",
    ...(dispositions !== undefined ? { dispositions } : {}),
  };
}

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

function signalLine(signal: Tier1Signal): string {
  // Every path and ADR name below is repo-authored content — fenced through
  // code() so the report can't become the injection surface S3 closed.
  switch (signal.kind) {
    case "governed-path":
      return `- governed-path: ${code(signal.adr)} governs ${signal.files.map(code).join(", ")}`;
    case "dependency-manifest":
      return `- dependency-manifest: ${signal.files.map(code).join(", ")}`;
    case "storage-schema":
      return `- storage-schema: ${signal.files.map(code).join(", ")}`;
  }
}

function renderTier1Block(tier1: Tier1Status): string[] {
  const lines = ["## Tier 1", ""];
  if (!tier1.enabled) {
    lines.push("Tier 1 semantic checks are disabled (tier1.enabled is not set).", "");
    return lines;
  }
  if (tier1.status === "no-credentials") {
    // PDR §2.8 fork doctrine: partial blindness is permitted, unannounced
    // blindness is not. The missing credential is NAMED per backend (the
    // transport module's map supplies it); api output stays byte-identical.
    lines.push(
      `Tier 1 is enabled, but ${tier1.credentialName ?? "ANTHROPIC_API_KEY"} is not present in the environment — semantic checks skipped; Tier 0 coverage only. Fork-triggered PRs never receive secrets; the absence is expected there.`,
      ""
    );
  } else if (tier1.status === "no-signal") {
    lines.push(
      "Tier 1 skipped: no signal — the diff touches no governed path and trips no architectural signal. Zero API calls made.",
      ""
    );
  } else if (tier1.calibration === undefined) {
    // Eligible but no run attached: `check` never runs Tier 1 (PDR §2.5) and
    // renders this pointer instead of pretending semantic coverage happened.
    lines.push(
      `Tier 1 eligible: ${tier1.signals.length} signal(s) detected. Semantic checks run under the report command; this output carries none.`,
      ""
    );
  } else {
    lines.push(`Tier 1 eligible: ${tier1.signals.length} signal(s) detected.`, "");
  }
  // The sweep's visible pause (ADR-0045 pause, ADR-0047 restart), loud among
  // the run details: the PDR 2.8 block with the unchecked units enumerated by
  // name, never summarized. There is no checkpoint to refuse and no resume;
  // the next run restarts from the beginning and redoes the work.
  if (tier1.paused !== undefined) {
    lines.push(
      `Tier 1 sweep paused: ${tier1.paused.completed} of ${tier1.paused.total} checks completed; the next run restarts from the beginning (no cross-run resume, ADR-0047).`,
      `Not checked: ${tier1.paused.notChecked.join(", ")}`,
      ""
    );
  }
  // Signals render for any status that carries them — under no-credentials the
  // gate still ran (it is free) and its output is coverage truth (ADR-0029).
  if (tier1.signals.length > 0) {
    for (const signal of tier1.signals) lines.push(signalLine(signal));
    lines.push("");
  }
  lines.push(...renderTier1Findings(tier1));
  return lines;
}

/** Analyst-voice caveat attached to every rendered Tier 1 finding (PDR §3.1, §2.6). */
const UNCALIBRATED_LABEL =
  "assessed by the checker — UNCALIBRATED (annex only; interrupts require a calibration entry, PDR §2.6)";

const INTERRUPT_SEVERITIES: InterruptSeverity[] = ["critical", "elevated", "routine"];

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(4);
}

/**
 * The per-severity calibration block (ADR-0042): each channel's state with its
 * numbers — open with its threshold, or closed with the sample size and the
 * bound that fell short — never a global shrug. These are channel statistics,
 * not finding confidences, so the measured numbers render here; raw
 * finding-confidence decimals still never appear in prose (PDR §3.1).
 */
function renderCalibrationBlock(calibration: "UNCALIBRATED" | CalibrationConsumption): string[] {
  const lines: string[] = ["### Calibration", ""];
  if (calibration === "UNCALIBRATED") {
    lines.push(
      "UNCALIBRATED — no calibration was consumed on this run; every finding is annex-only.",
      ""
    );
    return lines;
  }
  if (!calibration.calibrated) {
    lines.push(`UNCALIBRATED (${calibration.reason}): ${calibration.detail}`, "");
    return lines;
  }
  lines.push(
    `Artifact: ${calibration.source} (${code(calibration.sourcePath)}), corpus ${calibration.corpusHash.slice(0, 12)}, ${calibration.sampleSize} labeled finding(s). Channel states (ADR-0042 — a threshold opens only on the measured lower bound):`,
    ""
  );
  for (const severity of INTERRUPT_SEVERITIES) {
    const ch = calibration.perSeverity[severity];
    if (ch.state === "open") {
      lines.push(
        `- ${severity}: OPEN — threshold ${fmt(ch.threshold)} (n=${ch.sampleSize}, lower bound ${fmt(ch.lowerBound)} ≥ floor ${ch.floor})`
      );
    } else if (ch.refusedDecree !== undefined) {
      lines.push(
        `- ${severity}: CLOSED — the artifact asserted threshold ${fmt(ch.refusedDecree.assertedThreshold)}, REFUSED: ${ch.refusedDecree.reason} (measured, never decreed — ADR-0038/0042)`
      );
    } else {
      lines.push(
        `- ${severity}: CLOSED — n=${ch.sampleSize}, point ${fmt(ch.pointPrecision)}, lower bound ${fmt(ch.lowerBound)} < floor ${ch.floor}`
      );
    }
  }
  lines.push("- cosmetic: never interrupts (PDR §2.5, hard rule)");
  // A repo-local override that tried to open or lower a channel: refused loudly
  // (ADR-0049), the shipped value stood. Never a silent drop.
  for (const refusal of calibration.overrideRefusals ?? []) {
    lines.push(`- ${refusal.severity}: repo-local override REFUSED: ${refusal.reason}`);
  }
  lines.push("");
  return lines;
}

/**
 * Renders the run's findings section. Every model- or repo-derived string —
 * claims, consequences, quotes, document labels, error messages — is fenced
 * through code(): this text is untrusted content flowing into the job summary,
 * the exact surface S3 (ADR-0013) closed for Tier 0. Raw confidence decimals
 * do NOT appear here (PDR §3.1) — the numbers live in report.json.
 */
function renderTier1Findings(tier1: Tier1Status): string[] {
  if (!tier1.enabled || tier1.calibration === undefined) return [];
  const calibrated =
    typeof tier1.calibration === "object" && tier1.calibration.calibrated === true;
  const lines: string[] = [...renderCalibrationBlock(tier1.calibration)];

  const findings = tier1.findings ?? [];
  const dispositions = tier1.dispositions ?? [];

  // Interrupts first (ADR-0042): findings that route through an open channel.
  // They ALSO appear in the annex below — the interrupt is an additional push,
  // never a relocation; the report stays complete.
  const interrupts = findings
    .map((finding, i) => ({ finding, routed: dispositions[i] }))
    .filter((x) => x.routed?.disposition === "interrupt");
  if (interrupts.length > 0) {
    lines.push("### Interrupts", "");
    for (const { finding, routed } of interrupts) {
      lines.push(`- ${finding.check} (${routed!.severity}): ${code(finding.claim)}`);
      for (const citation of finding.citations) {
        lines.push(`  - Quoted from ${code(citation.document)}: ${code(citation.quote)}`);
      }
      lines.push(`  - Consequence: ${code(finding.consequence)}`);
      lines.push(
        `  - Disposition: interrupt — reported confidence at or above the calibrated threshold for ${routed!.severity} findings.`
      );
    }
    lines.push("");
  }

  lines.push(
    calibrated ? "### Findings (annex — the complete record)" : "### Findings (UNCALIBRATED — annex only)",
    ""
  );
  if (findings.length === 0) {
    lines.push("No Tier 1 findings were accepted in this run.", "");
  } else {
    findings.forEach((finding, i) => {
      const routed = dispositions[i];
      lines.push(`- ${finding.check}: ${code(finding.claim)}`);
      for (const citation of finding.citations) {
        lines.push(`  - Quoted from ${code(citation.document)}: ${code(citation.quote)}`);
      }
      lines.push(`  - Consequence: ${code(finding.consequence)}`);
      if (!calibrated || routed === undefined) {
        lines.push(`  - ${UNCALIBRATED_LABEL}`);
      } else if (routed.disposition === "interrupt") {
        lines.push(
          `  - assessed by the checker — severity ${routed.severity}; interrupted above (channel open).`
        );
      } else {
        lines.push(
          `  - assessed by the checker — severity ${routed.severity}; annex only (channel closed at this severity).`
        );
      }
    });
    lines.push("");
  }

  const discarded = tier1.discarded ?? [];
  const droppedCitations = tier1.droppedCitations ?? [];
  const livePremises = tier1.livePremises ?? [];
  const skipped = tier1.skipped ?? [];
  const errors = tier1.errors ?? [];
  if (
    discarded.length > 0 ||
    droppedCitations.length > 0 ||
    livePremises.length > 0 ||
    skipped.length > 0 ||
    errors.length > 0
  ) {
    for (const d of discarded) {
      lines.push(`- discarded (${d.reason}): ${d.check} — ${code(d.claim.slice(0, 80))}`);
    }
    // A citation dropped from within a surviving finding is counted too
    // (ADR-0033): a fabricated citation beside a real one is the same silent
    // drop the Pact forbids, one level down.
    for (const c of droppedCitations) {
      lines.push(`- dropped citation (${c.reason}): ${c.check} — ${code(c.claim.slice(0, 80))}`);
    }
    for (const s of skipped) {
      // ADR-0032: "too much to read in one call" is its own loud fact — the
      // measured size and the cap render, so a Tier 1 gap is never mistaken
      // for Tier 1 silence.
      if (s.reason === "input-exceeds-cap") {
        lines.push(
          `- skipped (input-exceeds-cap): ${s.check} — selected documents measure ${s.bytes} bytes; the single-call cap is ${s.cap} bytes (ADR-0032). Tier 0 coverage is unaffected; this check read nothing rather than silently reading part.`
        );
      } else {
        lines.push(`- skipped (${s.reason}): ${s.check}`);
      }
    }
    for (const e of errors) {
      lines.push(`- error: ${e.check} — ${code(e.message)}`);
    }
    // A premise dropped as still-live is reported, never vanished (ADR-0036):
    // the confirmation step is governed by the Pact's silence clause like every
    // other drop.
    for (const p of livePremises) {
      lines.push(`- live premise (dropped, not decay): ${p.check} — ${code(p.claim.slice(0, 80))}`);
    }
    lines.push("");
  }

  // Per-check measured token usage (ADR-0035, PDR §2.8 — measured, never
  // estimated). The numbers are the machine report's; the markdown carries a
  // one-line-per-check summary under the calibration frame.
  const usage = tier1.usage ?? [];
  if (usage.length > 0) {
    lines.push("Token usage (measured):");
    for (const u of usage) {
      lines.push(
        `- ${u.check}: input ${u.inputTokens}, output ${u.outputTokens}, cache read ${u.cacheReadTokens}, cache write ${u.cacheCreationTokens}`
      );
    }
    lines.push("");
  }
  return lines;
}

export function renderMarkdownReport(
  findings: Finding[],
  unrecognizedFiles: string[] = [],
  // Defaults to the config default (tier1 disabled) so a caller that predates
  // status resolution renders the honest common case, never a fabricated
  // enabled state.
  tier1: Tier1Status = { enabled: false }
): string {
  const sorted = sortFindings(findings);
  const failing = sorted.filter((f) => !f.advisory).length;
  const advisory = sorted.length - failing;
  const lines: string[] = ["# duckadrift report", ""];

  lines.push(`Tier 0 findings: ${sorted.length} (${failing} failing, ${advisory} advisory)`);
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

  lines.push(...renderTier1Block(tier1));

  return lines.join("\n");
}

export interface JsonReport {
  tier0Findings: Finding[];
  /** null = the scan aborted before Tier 1 status resolution (ADR-0013 error report). */
  tier1: Tier1Status | null;
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
    // Claiming a Tier 1 status here would be a fabrication — the scan failed
    // before the question could be answered, and the report says so (the JSON
    // mirrors this with tier1: null).
    "Tier 1: unresolved — the scan aborted before Tier 1 status resolution",
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
  unrecognizedFiles: string[] = [],
  // Deliberately no default: the JSON report is the machine-read surface, and
  // a defaulted status here would be a fabricated answer if a caller forgot to
  // resolve one. Only buildErrorReport may write null (scan aborted first).
  tier1: Tier1Status
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
    tier1,
    checkCounts,
    failingCount: sorted.length - advisoryCount,
    advisoryCount,
    adrDirRelative,
    unrecognizedFiles,
  };
}
