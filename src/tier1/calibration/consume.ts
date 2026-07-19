import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wilsonLowerBound } from "./curve.js";
import { SEVERITY_FLOORS, type CalibrationEntry, type InterruptSeverity } from "./schema.js";

// Calibration consumption (ADR-0042, PDR §2.6). The runtime reads the
// calibration artifact and derives each severity's channel state — but the
// artifact is DATA, not authority: a channel opens only when the entry carries
// a threshold AND its measured Wilson lower bound meets the §2.5 floor, both
// re-verified here at read time. An artifact edited to assert a threshold
// without the bound behind it is refused with the failure named ("measured,
// never decreed"). Cosmetic never opens regardless of any entry (PDR §2.5,
// hard rule — enforced by the router, structural here: cosmetic has no channel).

/** One severity's channel, with the numbers the report renders. */
export type ChannelState =
  | { state: "open"; threshold: number; floor: number; sampleSize: number; lowerBound: number }
  | {
      state: "closed";
      floor: number;
      sampleSize: number;
      pointPrecision: number | null;
      lowerBound: number | null;
      /** Present when the entry ASSERTED a threshold the gate refused — the decreed opening (ADR-0042). `recomputedLowerBound` is the Wilson bound re-derived at consumption from the curve point's own (truePositives, n); null when no curve point supports the threshold at all. */
      refusedDecree?: {
        assertedThreshold: number;
        lowerBound: number | null;
        recomputedLowerBound: number | null;
        floor: number;
        reason: string;
      };
    };

export type CalibrationConsumption =
  | {
      calibrated: false;
      /** Named, loud: no artifact found, artifact unreadable, or no entry for this run's tuple. */
      reason: "no-artifact" | "unreadable" | "no-entry";
      detail: string;
    }
  | {
      calibrated: true;
      /** Which artifact answered (ADR-0049): the shipped baseline, or a repo-local override that TIGHTENED it. Opening is a shipped-artifact property; a repo may only constrain. */
      source: "shipped" | "repo-local-override";
      sourcePath: string;
      corpusHash: string;
      sampleSize: number;
      perSeverity: Record<InterruptSeverity, ChannelState>;
      /** A repo-local override that tried to OPEN a closed channel or LOWER a threshold: refused loudly (ADR-0049), the shipped value stood. Named per severity, never silently dropped. */
      overrideRefusals?: Array<{ severity: InterruptSeverity; reason: string }>;
    };

const INTERRUPT_SEVERITIES: InterruptSeverity[] = ["critical", "elevated", "routine"];

/** The artifact packaged with the action — this repository's own calibration.json, resolved relative to the built module. Overridable for tests. */
export function shippedCalibrationPath(): string {
  // dist/tier1/calibration/consume.js → ../../../calibration.json
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "calibration.json");
}

// Strict validation at read (ADR-0049): every field's TYPE and RANGE, not just
// the top-level schema. A calibration artifact is untrusted input (ADR-0046);
// a string where a number belongs would coerce through the numeric gate, and a
// missing severity would crash it. Anything malformed makes the whole file
// unreadable, loudly: never a coerced value, never a thrown error.

function isNumberInRange(v: unknown, lo: number, hi: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
}

function isNonNegativeInteger(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isProbabilityOrNull(v: unknown): boolean {
  return v === null || isNumberInRange(v, 0, 1);
}

function isValidCurvePoint(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (!isNonNegativeInteger(p.n)) return false;
  if (!isNonNegativeInteger(p.truePositives) || (p.truePositives as number) > (p.n as number)) return false;
  return isNumberInRange(p.confidence, 0, 1) && isNumberInRange(p.precision, 0, 1) && isNumberInRange(p.wilsonLower, 0, 1);
}

function isValidSeverityCalibration(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isNumberInRange(s.floor, 0, 1) &&
    isProbabilityOrNull(s.threshold) &&
    isNonNegativeInteger(s.sampleSize) &&
    isProbabilityOrNull(s.pointPrecision) &&
    isProbabilityOrNull(s.lowerBound) &&
    Array.isArray(s.curve) &&
    s.curve.every(isValidCurvePoint)
  );
}

function isValidEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  const key = e.key as Record<string, unknown> | undefined;
  if (
    typeof key !== "object" ||
    key === null ||
    typeof key.backend !== "string" ||
    typeof key.model !== "string" ||
    typeof key.effort !== "string"
  ) {
    return false;
  }
  if (typeof e.corpusHash !== "string" || !isNonNegativeInteger(e.sampleSize)) return false;
  const perSeverity = e.perSeverity as Record<string, unknown> | undefined;
  if (typeof perSeverity !== "object" || perSeverity === null) return false;
  return INTERRUPT_SEVERITIES.every((severity) => isValidSeverityCalibration(perSeverity[severity]));
}

function readCalibrationEntries(path: string): CalibrationEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).schemaVersion !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    return null;
  }
  const entries = (parsed as { entries: unknown[] }).entries;
  // One malformed entry makes the whole file unreadable (loud, never guessed).
  if (!entries.every(isValidEntry)) return null;
  return entries as CalibrationEntry[];
}

/** Numerical tolerance for stored-vs-recomputed bound agreement — float round-trip noise only, never a semantic gap. */
const BOUND_TOLERANCE = 1e-9;

/**
 * Derives one severity's channel state from its calibration. The opening
 * condition is RE-DERIVED from the entry's own measurements — the curve, not
 * the summary fields (ADR-0042; verifier-defeated first version trusted the
 * stored lowerBound, so an artifact edited in BOTH fields opened). An OPEN
 * verdict requires, at consumption:
 *   1. a curve point whose confidence equals the asserted threshold —
 *      thresholds are curve crossings by construction; no point, no opening;
 *   2. the Wilson 95% lower bound recomputed HERE from that point's own
 *      (truePositives, n) — the same wilsonLowerBound the fit uses, never a
 *      second implementation — meeting the §2.5 floor;
 *   3. the stored lowerBound agreeing with the recomputation (float tolerance
 *      only) — a mismatch is a tampered artifact and refuses even when the
 *      true measurement would open, because integrity failed.
 * The floor is the §2.5 constant, NOT the entry's `floor` field: an artifact
 * that lowered its own floor would otherwise open a channel by decree. A fully
 * self-consistent fabricated curve still opens — that is the review boundary's
 * job (corpusHash + the verifier's re-fit), not this gate's.
 */
export function deriveChannelState(
  cal: CalibrationEntry["perSeverity"][InterruptSeverity],
  severity: InterruptSeverity
): ChannelState {
  const floor = SEVERITY_FLOORS[severity];
  if (cal.threshold !== null) {
    const refuse = (recomputed: number | null, reason: string): ChannelState => ({
      state: "closed",
      floor,
      sampleSize: cal.sampleSize,
      pointPrecision: cal.pointPrecision,
      lowerBound: cal.lowerBound,
      refusedDecree: {
        assertedThreshold: cal.threshold as number,
        lowerBound: cal.lowerBound,
        recomputedLowerBound: recomputed,
        floor,
        reason,
      },
    });

    const point = cal.curve.find((p) => p.confidence === cal.threshold);
    if (point === undefined) {
      return refuse(null, "threshold has no curve support");
    }
    const recomputed = wilsonLowerBound(point.truePositives, point.n);
    if (recomputed < floor) {
      return refuse(
        recomputed,
        `recomputed lower bound ${recomputed.toFixed(4)} (from the curve point's ${point.truePositives}/${point.n}) does not meet floor ${floor}; stored lowerBound was ${cal.lowerBound === null ? "null" : cal.lowerBound.toFixed(4)}`
      );
    }
    if (cal.lowerBound === null || Math.abs(recomputed - cal.lowerBound) > BOUND_TOLERANCE) {
      return refuse(
        recomputed,
        `stored lowerBound ${cal.lowerBound === null ? "null" : cal.lowerBound.toFixed(4)} disagrees with the bound recomputed from the curve (${recomputed.toFixed(4)}) — tampered artifact, refused`
      );
    }
    return {
      state: "open",
      threshold: cal.threshold,
      floor,
      sampleSize: cal.sampleSize,
      lowerBound: recomputed,
    };
  }
  return {
    state: "closed",
    floor,
    sampleSize: cal.sampleSize,
    pointPrecision: cal.pointPrecision,
    lowerBound: cal.lowerBound,
  };
}

/**
 * Combines the shipped baseline channel with a repo-local override, letting the
 * override only TIGHTEN (ADR-0049): close an open channel or raise a threshold.
 * An override that would OPEN a closed channel or LOWER a threshold is refused;
 * the shipped value stands and the refusal is named. Opening is a property of
 * the verifier-reviewed shipped artifact, which a repo cannot self-certify.
 */
function tightenChannel(
  severity: InterruptSeverity,
  shipped: ChannelState,
  override: ChannelState
): { channel: ChannelState; refusal?: string } {
  if (shipped.state === "closed") {
    // Shipped closed is already maximally strict for opening. An override that
    // opens is refused; anything else leaves the shipped channel closed.
    if (override.state === "open") {
      return {
        channel: shipped,
        refusal: `the repo-local override opened the ${severity} channel the shipped artifact leaves closed; refused (a repo may tighten, never open, ADR-0049), the shipped closed channel stands`,
      };
    }
    return { channel: shipped };
  }
  // Shipped OPEN: the override may close it, or raise its threshold, never lower.
  if (override.state === "closed") {
    return { channel: override };
  }
  if (override.threshold < shipped.threshold) {
    return {
      channel: shipped,
      refusal: `the repo-local override lowered the ${severity} threshold below the shipped value; refused (a repo may raise, never lower, ADR-0049), the shipped threshold stands`,
    };
  }
  return { channel: override.threshold > shipped.threshold ? override : shipped };
}

function matchesKey(
  entry: CalibrationEntry,
  key: { backend: string; model: string; effort: string }
): boolean {
  return entry.key.backend === key.backend && entry.key.model === key.model && entry.key.effort === key.effort;
}

/**
 * Loads the calibration for a run (ADR-0049). The SHIPPED (verifier-reviewed)
 * artifact is the authority for OPENING. A `calibration.json` at the scanned
 * repo's root is a CONSTRAINT on top of it, not a replacement: it may only
 * tighten a channel, never open one the shipped leaves closed. A malformed
 * repo-local file is a named uncalibrated state, loudly, never a silent
 * fall-through and never a coerced value.
 */
export function consumeCalibration(
  repoRoot: string,
  key: { backend: string; model: string; effort: string },
  shippedPath: string = shippedCalibrationPath()
): CalibrationConsumption {
  // The shipped baseline: the only source of an OPEN channel.
  if (!existsSync(shippedPath)) {
    return { calibrated: false, reason: "no-artifact", detail: "no shipped calibration artifact found: this run is uncalibrated" };
  }
  const shippedEntries = readCalibrationEntries(shippedPath);
  if (shippedEntries === null) {
    return {
      calibrated: false,
      reason: "unreadable",
      detail: `the shipped calibration at ${shippedPath} is not a valid schemaVersion 1 calibration file: treated as uncalibrated, loudly, rather than guessed at`,
    };
  }
  const shippedEntry = shippedEntries.find((e) => matchesKey(e, key));
  if (shippedEntry === undefined) {
    return {
      calibrated: false,
      reason: "no-entry",
      detail: `the shipped calibration carries no entry for {backend: ${key.backend}, model: ${key.model}, effort: ${key.effort}}: this run is uncalibrated`,
    };
  }

  const baseline = {} as Record<InterruptSeverity, ChannelState>;
  for (const severity of INTERRUPT_SEVERITIES) {
    baseline[severity] = deriveChannelState(shippedEntry.perSeverity[severity], severity);
  }

  // A repo-local override, if present, may only tighten the baseline.
  let source: "shipped" | "repo-local-override" = "shipped";
  let perSeverity = baseline;
  const overrideRefusals: Array<{ severity: InterruptSeverity; reason: string }> = [];
  const localPath = join(repoRoot, "calibration.json");
  if (existsSync(localPath)) {
    const localEntries = readCalibrationEntries(localPath);
    if (localEntries === null) {
      // The repo declared a calibration and it is malformed: loud, never guessed.
      return {
        calibrated: false,
        reason: "unreadable",
        detail: `the repo-local calibration at ${localPath} is not a valid schemaVersion 1 calibration file: treated as uncalibrated, loudly, rather than guessed at`,
      };
    }
    const localEntry = localEntries.find((e) => matchesKey(e, key));
    if (localEntry !== undefined) {
      source = "repo-local-override";
      const constrained = {} as Record<InterruptSeverity, ChannelState>;
      for (const severity of INTERRUPT_SEVERITIES) {
        const overrideChannel = deriveChannelState(localEntry.perSeverity[severity], severity);
        const { channel, refusal } = tightenChannel(severity, baseline[severity], overrideChannel);
        constrained[severity] = channel;
        if (refusal !== undefined) overrideRefusals.push({ severity, reason: refusal });
      }
      perSeverity = constrained;
    }
    // A repo-local that carries no entry for this tuple constrains nothing; the
    // shipped baseline stands.
  }

  return {
    calibrated: true,
    source,
    sourcePath: shippedPath,
    corpusHash: shippedEntry.corpusHash,
    sampleSize: shippedEntry.sampleSize,
    perSeverity,
    ...(overrideRefusals.length > 0 ? { overrideRefusals } : {}),
  };
}
