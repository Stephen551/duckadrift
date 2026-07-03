import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Finding, FindingEvidence, TierZeroCheckId } from "../../src/types.js";
import { TIER_ZERO_CHECK_IDS } from "../../src/types.js";

/**
 * Validates the shape of a single Finding, throwing a descriptive error on
 * any defect. This is the harness's own contract check — it has nothing to
 * do with whether a D1-D7 detector (M1 scope) produced the right answer.
 */
export function validateFinding(value: unknown, context: string): Finding {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${context}: finding must be an object, got ${typeof value}`);
  }
  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.check !== "string" ||
    !TIER_ZERO_CHECK_IDS.includes(candidate.check as TierZeroCheckId)
  ) {
    throw new Error(
      `${context}: "check" must be one of ${TIER_ZERO_CHECK_IDS.join(", ")}, got ${JSON.stringify(candidate.check)}`
    );
  }

  if (typeof candidate.claim !== "string" || candidate.claim.trim() === "") {
    throw new Error(`${context}: "claim" must be a non-empty string`);
  }

  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
    throw new Error(`${context}: "evidence" must be a non-empty array`);
  }
  for (const [i, item] of candidate.evidence.entries()) {
    if (typeof item !== "object" || item === null) {
      throw new Error(`${context}: evidence[${i}] must be an object`);
    }
    const ev = item as Record<string, unknown>;
    if (ev.adr === undefined && ev.file === undefined) {
      throw new Error(`${context}: evidence[${i}] must cite an "adr" or a "file"`);
    }
  }

  if (typeof candidate.consequence !== "string" || candidate.consequence.trim() === "") {
    throw new Error(`${context}: "consequence" must be a non-empty string`);
  }

  if (candidate.advisory !== undefined && typeof candidate.advisory !== "boolean") {
    throw new Error(`${context}: "advisory" must be a boolean when present`);
  }

  return {
    check: candidate.check as TierZeroCheckId,
    claim: candidate.claim,
    evidence: candidate.evidence as FindingEvidence[],
    consequence: candidate.consequence,
    ...(candidate.advisory !== undefined ? { advisory: candidate.advisory as boolean } : {}),
  };
}

export function validateFindingsArray(value: unknown, context: string): Finding[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context}: expected-findings must be an array, got ${typeof value}`);
  }
  return value.map((entry, i) => validateFinding(entry, `${context}[${i}]`));
}

export function loadExpectedFindings(fixtureDir: string): Finding[] {
  const path = join(fixtureDir, "expected-findings.json");
  if (!existsSync(path)) {
    throw new Error(`${fixtureDir}: missing expected-findings.json`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return validateFindingsArray(raw, fixtureDir);
}

export function listFixtureDirs(tier0Dir: string): string[] {
  return readdirSync(tier0Dir).filter((entry) => statSync(join(tier0Dir, entry)).isDirectory());
}
