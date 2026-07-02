import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_ZERO_CHECK_IDS } from "../src/types.js";
import { listFixtureDirs, loadExpectedFindings } from "./helpers/fixture-schema.js";
import { runFixture, runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER0_DIR = join(__dirname, "fixtures", "tier0");
const fixtureDirs = listFixtureDirs(TIER0_DIR);

/** Maps `d3-reference-integrity` -> `D3`; the clean baseline has no owner. */
function targetCheckFor(fixtureName: string): string | null {
  const match = /^d(\d)-/.exec(fixtureName);
  return match ? `D${match[1]}` : null;
}

describe("Gate G1: fixtures pass exactly", () => {
  for (const fixtureName of fixtureDirs) {
    it(`${fixtureName}: real detector output matches expected-findings.json exactly`, () => {
      const dir = join(TIER0_DIR, fixtureName);
      const expected = loadExpectedFindings(dir);
      const actual = runFixture(dir);
      expect(actual).toEqual(expected);
    });
  }
});

describe("Gate G1: behavioral isolation matrix (every check x every fixture)", () => {
  for (const fixtureName of fixtureDirs) {
    const targetCheck = targetCheckFor(fixtureName);
    const dir = join(TIER0_DIR, fixtureName);

    for (const checkId of TIER_ZERO_CHECK_IDS) {
      const shouldFire = checkId === targetCheck;
      it(`${fixtureName}: ${checkId} ${shouldFire ? "fires (owning check)" : "does not fire"}`, () => {
        const findings = runSingleCheck(dir, checkId);
        if (shouldFire) {
          expect(findings.length).toBeGreaterThan(0);
        } else {
          expect(findings).toEqual([]);
        }
      });
    }
  }
});
