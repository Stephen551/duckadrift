/**
 * Shared data contract for Tier 0 findings (PDR §2.3, §3.1).
 * No detection logic lives here — checks D1-D7 are M1 scope. This is the
 * shape the fixture corpus's expected-findings snapshots are written against,
 * and the shape M1's checkers will produce.
 */

export type TierZeroCheckId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";

export interface FindingEvidence {
  adr?: string;
  file?: string;
  line?: number;
}

export interface Finding {
  check: TierZeroCheckId;
  claim: string;
  evidence: FindingEvidence[];
  consequence: string;
  /**
   * True when this finding is informational only and must never fail CI —
   * e.g. a structural claim resting on a guessed (not user-declared)
   * dialect. Undefined/false means the finding is asserted as fact, the
   * default for every Tier 0 check (ADR-0005).
   */
  advisory?: boolean;
}

export const TIER_ZERO_CHECK_IDS: readonly TierZeroCheckId[] = [
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
  "D6",
  "D7",
];
