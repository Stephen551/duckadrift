import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_ZERO_CHECK_IDS } from "../src/types.js";
import {
  listFixtureDirs,
  loadExpectedFindings,
  validateFindingsArray,
} from "./helpers/fixture-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER0_DIR = join(__dirname, "fixtures", "tier0");

const fixtureDirs = listFixtureDirs(TIER0_DIR);

/** Maps `d3-reference-integrity` -> `D3`. Fixtures without a `dN-` prefix (the clean baseline) return null. */
function targetCheckFor(fixtureName: string): string | null {
  const match = /^d(\d)-/.exec(fixtureName);
  return match ? `D${match[1]}` : null;
}

describe("Tier 0 fixture corpus: structural validity", () => {
  it("has at least one fixture directory", () => {
    expect(fixtureDirs.length).toBeGreaterThan(0);
  });

  for (const fixtureName of fixtureDirs) {
    it(`${fixtureName}: expected-findings.json is well-formed`, () => {
      expect(() => loadExpectedFindings(join(TIER0_DIR, fixtureName))).not.toThrow();
    });
  }
});

describe("Tier 0 fixture corpus: isolation (mutation rule)", () => {
  for (const fixtureName of fixtureDirs) {
    const targetCheck = targetCheckFor(fixtureName);

    if (targetCheck === null) {
      it(`${fixtureName}: is the clean baseline and expects zero findings`, () => {
        const findings = loadExpectedFindings(join(TIER0_DIR, fixtureName));
        expect(findings).toEqual([]);
      });
      continue;
    }

    it(`${fixtureName}: every expected finding is tagged ${targetCheck}, not some other check`, () => {
      const findings = loadExpectedFindings(join(TIER0_DIR, fixtureName));
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        expect(finding.check).toBe(targetCheck);
      }
    });
  }
});

describe("Tier 0 fixture corpus: check coverage", () => {
  it("every D1-D7 check has at least one isolating fixture", () => {
    // Not "exactly one": D1's fact-vs-advisory split (ADR-0005) means the
    // declared-dialect and undeclared-dialect cases can't share a fixture
    // directory — dialect declaration is repo-wide, so they need separate
    // "repos" to demonstrate both branches. More than one fixture per check
    // is fine as long as each individually isolates the check (verified above).
    const covered = fixtureDirs.map(targetCheckFor).filter((c): c is string => c !== null);
    expect(new Set(covered)).toEqual(new Set(TIER_ZERO_CHECK_IDS));
  });
});

describe("Gate G0: harness red-greens on a hand-broken fixture", () => {
  it("red: a finding with an invalid check id is rejected", () => {
    const broken = [
      {
        check: "D99",
        claim: "This check id does not exist.",
        evidence: [{ adr: "0001-example.md" }],
        consequence: "Should never validate.",
      },
    ];
    expect(() => validateFindingsArray(broken, "hand-broken fixture")).toThrow(/check/i);
  });

  it("red: a finding missing required fields is rejected", () => {
    const broken = [{ check: "D1", claim: "Missing evidence and consequence." }];
    expect(() => validateFindingsArray(broken, "hand-broken fixture")).toThrow(/evidence/i);
  });

  it("green: the same fixture, hand-fixed, validates cleanly", () => {
    const fixed = [
      {
        check: "D1",
        claim: "This check id exists and the finding is complete.",
        evidence: [{ adr: "0001-example.md" }],
        consequence: "Validates without throwing.",
      },
    ];
    expect(() => validateFindingsArray(fixed, "hand-fixed fixture")).not.toThrow();
  });
});
