// The calibration.json schema (ADR-0038, PDR §2.6). This is the moat artifact:
// chosen precision floors turned into MEASURED confidence thresholds, keyed by
// the same {backend, model, effort} tuple as the recordings (ADR-0028) so the
// test loop and the calibration doctrine cannot drift apart. Nothing here
// consumes the runtime; M4.0 is the harness alone.

export type Severity = "critical" | "elevated" | "routine" | "cosmetic";

/** Severities that can interrupt (§2.5). `cosmetic` never interrupts, so it is deliberately absent from perSeverity. */
export type InterruptSeverity = "critical" | "elevated" | "routine";

/**
 * The §2.5 precision floors — the ONE place a typed number is legitimate:
 * these are CHOSEN tolerances, not measured thresholds (PDR §1.6, correction 2:
 * "tolerances are chosen, thresholds are measured"). A false alarm against a
 * critical decision costs more than a miss, so critical LOWERS the bar; routine
 * demands the most precision before it may push. `cosmetic` never interrupts.
 */
export const SEVERITY_FLOORS: Record<InterruptSeverity, number> = {
  critical: 0.75,
  elevated: 0.9,
  routine: 0.95,
};

/** One point on the published precision-vs-confidence curve — the evidence for every threshold and every closure (ADR-0012: "the curve is the citation"). */
export interface CurvePoint {
  confidence: number;
  n: number;
  truePositives: number;
  precision: number;
  wilsonLower: number;
}

export interface SeverityCalibration {
  /** The §2.5 precision floor this severity must meet. */
  floor: number;
  /**
   * The confidence value where the floor is met WITH the Wilson lower bound
   * above it; null = the channel stays closed for this severity (a correct,
   * reportable outcome, ADR-0038 — not an error).
   */
  threshold: number | null;
  /** Labeled findings at this severity. */
  sampleSize: number;
  /** Precision at the threshold (or best observed when closed). */
  pointPrecision: number | null;
  /** Wilson 95% lower bound at the threshold (or best observed when closed). */
  lowerBound: number | null;
  curve: CurvePoint[];
}

export interface CalibrationEntry {
  key: { backend: "api" | "claude-code"; model: string; effort: string };
  /** sha256 of the canonical labeled corpus (review.ts defines the canonicalization). */
  corpusHash: string;
  /** Total labeled findings in this entry's corpus. */
  sampleSize: number;
  generatedAt: string; // ISO
  perSeverity: Record<InterruptSeverity, SeverityCalibration>;
  // cosmetic never interrupts (§2.5) — deliberately absent from perSeverity.
}

export interface CalibrationFile {
  schemaVersion: 1;
  entries: CalibrationEntry[];
}

/** Deterministic serialization (sorted keys, trailing newline) so `fit` output is byte-stable across runs (a report that lives in git, PDR §3.2). */
export function serializeCalibration(file: CalibrationFile): string {
  return `${stableStringify(file)}\n`;
}

/** JSON with object keys sorted recursively — stable bytes for the same content. */
function stableStringify(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${padInner}${stableStringify(v, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${padInner}${JSON.stringify(k)}: ${stableStringify((value as Record<string, unknown>)[k], indent + 1)}`);
  if (entries.length === 0) return "{}";
  return `{\n${entries.join(",\n")}\n${pad}}`;
}
