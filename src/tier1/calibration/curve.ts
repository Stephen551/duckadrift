import type { CurvePoint, SeverityCalibration } from "./schema.js";

// The curve math (ADR-0038). A severity's interrupt threshold is the smallest
// reported-confidence value whose cohort meets the precision floor WITH the
// Wilson 95% lower bound above the floor — never the point estimate alone. A
// small corpus carries a wide interval; a siren opened on a lucky point
// estimate is wrong in exactly the way the founding decision forbids. Where no
// cohort clears the bound, the threshold is null and the channel stays closed —
// a correct, publishable outcome, with the curve as the evidence.

const Z = 1.96; // 95% two-sided normal quantile

/**
 * Wilson score interval lower bound for k successes in n trials. The standard
 * small-sample interval for a proportion — implemented exactly, not
 * approximated. n=0 yields 0 (no evidence supports any floor).
 */
export function wilsonLowerBound(k: number, n: number): number {
  if (n === 0) return 0;
  const p = k / n;
  const z2 = Z * Z;
  const numerator = p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return numerator / (1 + z2 / n);
}

export interface LabeledFinding {
  confidence: number;
  label: boolean;
}

/**
 * Fits one severity's calibration from its labeled findings. Candidate
 * thresholds are the distinct confidence values, descending; each candidate's
 * cohort is all findings at or above it. The threshold is the SMALLEST
 * candidate whose cohort's Wilson lower bound clears the floor.
 */
export function fitSeverity(labeled: LabeledFinding[], floor: number): SeverityCalibration {
  const candidates = [...new Set(labeled.map((f) => f.confidence))].sort((a, b) => b - a);
  const curve: CurvePoint[] = [];
  for (const confidence of candidates) {
    const cohort = labeled.filter((f) => f.confidence >= confidence);
    const n = cohort.length;
    const truePositives = cohort.filter((f) => f.label).length;
    const precision = n === 0 ? 0 : truePositives / n;
    curve.push({
      confidence,
      n,
      truePositives,
      precision,
      wilsonLower: wilsonLowerBound(truePositives, n),
    });
  }

  // The smallest candidate (widest cohort) whose bound clears the floor. Curve
  // is descending by confidence, so the LAST clearing point is the smallest
  // confidence — scan from the end.
  let opened: CurvePoint | null = null;
  for (let i = curve.length - 1; i >= 0; i--) {
    if (curve[i]!.wilsonLower >= floor) {
      opened = curve[i]!;
      break;
    }
  }

  // When closed, report the best-observed slice (highest lower bound) so the
  // report can say how far the corpus is from opening — growth is arithmetic,
  // not a judgment call (ADR-0038).
  const best = curve.reduce<CurvePoint | null>(
    (acc, p) => (acc === null || p.wilsonLower > acc.wilsonLower ? p : acc),
    null
  );

  return {
    floor,
    threshold: opened ? opened.confidence : null,
    sampleSize: labeled.length,
    pointPrecision: opened ? opened.precision : best?.precision ?? null,
    lowerBound: opened ? opened.wilsonLower : best?.wilsonLower ?? null,
    curve,
  };
}
