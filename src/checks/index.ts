import type { AdrLogContext } from "../adr/types.js";
import type { Finding, TierZeroCheckId } from "../types.js";
import { d1SchemaLint } from "./d1-schema-lint.js";
import { d2StatusGraphIntegrity } from "./d2-status-graph.js";
import { d3ReferenceIntegrity } from "./d3-reference-integrity.js";
import { d4GhostReferences } from "./d4-ghost-references.js";
import { d5GovernedPathGate } from "./d5-governed-path-gate.js";
import { d6StalenessClock } from "./d6-staleness-clock.js";
import { d7LogIndexDrift } from "./d7-log-index-drift.js";

export type TierZeroCheck = (ctx: AdrLogContext) => Finding[];

export const TIER_ZERO_CHECKS: Record<TierZeroCheckId, TierZeroCheck> = {
  D1: d1SchemaLint,
  D2: d2StatusGraphIntegrity,
  D3: d3ReferenceIntegrity,
  D4: d4GhostReferences,
  D5: d5GovernedPathGate,
  D6: d6StalenessClock,
  D7: d7LogIndexDrift,
};

export function runAllTierZeroChecks(ctx: AdrLogContext): Finding[] {
  return Object.values(TIER_ZERO_CHECKS).flatMap((check) => check(ctx));
}
