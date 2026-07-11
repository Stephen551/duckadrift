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
      /** Which artifact answered (PDR §2.6.6): the scanned repo's own file overrides the shipped one. */
      source: "repo-local" | "shipped";
      sourcePath: string;
      corpusHash: string;
      sampleSize: number;
      perSeverity: Record<InterruptSeverity, ChannelState>;
    };

const INTERRUPT_SEVERITIES: InterruptSeverity[] = ["critical", "elevated", "routine"];

/** The artifact packaged with the action — this repository's own calibration.json, resolved relative to the built module. Overridable for tests. */
export function shippedCalibrationPath(): string {
  // dist/tier1/calibration/consume.js → ../../../calibration.json
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "calibration.json");
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
  return (parsed as { entries: CalibrationEntry[] }).entries;
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
 * Loads the calibration for a run. Load order (PDR §2.6.6): a `calibration.json`
 * at the SCANNED repo's root overrides the shipped artifact. An unreadable
 * repo-local file is a named uncalibrated state, never a silent fall-through to
 * the shipped one — a repo that declared its own calibration and got the shipped
 * numbers instead would be consuming an artifact it did not choose.
 */
export function consumeCalibration(
  repoRoot: string,
  key: { backend: string; model: string; effort: string },
  shippedPath: string = shippedCalibrationPath()
): CalibrationConsumption {
  const localPath = join(repoRoot, "calibration.json");
  let source: "repo-local" | "shipped";
  let path: string;
  if (existsSync(localPath)) {
    source = "repo-local";
    path = localPath;
  } else if (existsSync(shippedPath)) {
    source = "shipped";
    path = shippedPath;
  } else {
    return { calibrated: false, reason: "no-artifact", detail: "no calibration.json found (repo-local or shipped)" };
  }

  const entries = readCalibrationEntries(path);
  if (entries === null) {
    return {
      calibrated: false,
      reason: "unreadable",
      detail: `${source} calibration at ${path} is not a schemaVersion 1 calibration file — treated as uncalibrated, loudly, rather than guessed at`,
    };
  }

  const entry = entries.find(
    (e) => e.key.backend === key.backend && e.key.model === key.model && e.key.effort === key.effort
  );
  if (entry === undefined) {
    return {
      calibrated: false,
      reason: "no-entry",
      detail: `${source} calibration carries no entry for {backend: ${key.backend}, model: ${key.model}, effort: ${key.effort}} — this run is uncalibrated`,
    };
  }

  const perSeverity = {} as Record<InterruptSeverity, ChannelState>;
  for (const severity of INTERRUPT_SEVERITIES) {
    perSeverity[severity] = deriveChannelState(entry.perSeverity[severity], severity);
  }
  return {
    calibrated: true,
    source,
    sourcePath: path,
    corpusHash: entry.corpusHash,
    sampleSize: entry.sampleSize,
    perSeverity,
  };
}
