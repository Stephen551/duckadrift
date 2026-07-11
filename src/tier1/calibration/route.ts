import type { ParsedAdr } from "../../adr/types.js";
import type { Tier1Finding } from "../citations.js";
import type { CalibrationConsumption } from "./consume.js";
import type { Severity } from "./schema.js";
import { deriveFindingSeverity } from "./severity.js";

// The channel router's interrupt arm (ADR-0042, PDR §2.5). A finding routes to
// INTERRUPT iff its derived severity's channel is OPEN and its model-reported
// confidence sits at or above that severity's measured threshold. Everything
// else — and every interrupting finding TOO — stays in the annex: the report is
// complete, the interrupt is an additional push, never a relocation. Cosmetic
// never interrupts regardless of any calibration entry (hard rule).

export interface RoutedFinding {
  /** Derived per ADR-0038's rule: MAX severity among cited ADRs, routine default. */
  severity: Severity;
  disposition: "interrupt" | "annex";
  /** Present on an interrupt: the measured threshold the finding cleared. */
  threshold?: number;
}

/**
 * Routes each finding, index-aligned with the input array. An uncalibrated run
 * routes everything to the annex (today's behavior, unchanged).
 */
export function routeFindings(
  findings: readonly Tier1Finding[],
  adrsByFileName: Map<string, ParsedAdr>,
  consumption: CalibrationConsumption
): RoutedFinding[] {
  return findings.map((finding) => {
    const severity = deriveFindingSeverity(finding, adrsByFileName);
    // Cosmetic has no channel, structurally (PDR §2.5) — and an uncalibrated
    // run has no open channel to route through.
    if (severity === "cosmetic" || !consumption.calibrated) {
      return { severity, disposition: "annex" };
    }
    const channel = consumption.perSeverity[severity];
    if (channel.state === "open" && finding.reportedConfidence >= channel.threshold) {
      return { severity, disposition: "interrupt", threshold: channel.threshold };
    }
    return { severity, disposition: "annex" };
  });
}
