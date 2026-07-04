import { describe, expect, it } from "vitest";
import { ADR_FILENAME_RE } from "../src/adr/parse.js";
import { SLUG_RE } from "../src/checks/d1-schema-lint.js";

// S6 (ADR-0013): both regexes had a nested quantifier `(?:[a-zA-Z]+-?)*` that
// backtracked catastrophically on a letters-only filename with no digit — a
// ~50-char name pinned a CPU until CI's 6-hour kill. The linear `[a-zA-Z-]*`
// prefix matches the same real ADR names in bounded time.

// 28 letters, no digit — the backtracking trigger. On the pre-fix pattern this
// takes several seconds and climbs exponentially with length; the fixed pattern
// resolves it in well under a millisecond. The threshold is generous (the fixed
// pattern is ~0.2ms) but far below the pre-fix cost, so the test is both
// non-flaky and red on v0.1.0.
const PATHOLOGICAL = "a".repeat(28) + ".md";
const BUDGET_MS = 1000;

function elapsed(fn: () => void): number {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

describe("S6: ADR filename regexes resolve in bounded time (no ReDoS)", () => {
  it("ADR_FILENAME_RE handles a long letters-only name fast and rejects it", () => {
    let result = true;
    const ms = elapsed(() => {
      result = ADR_FILENAME_RE.test(PATHOLOGICAL);
    });
    expect(result).toBe(false); // no digit -> not an ADR
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("SLUG_RE handles the same input fast", () => {
    let result = true;
    const ms = elapsed(() => {
      result = SLUG_RE.test(PATHOLOGICAL);
    });
    expect(result).toBe(false);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still recognizes real ADR filename conventions", () => {
    for (const name of ["0001-foo.md", "adr-002-foo.md", "adr001-foo.md", "ODH-ADR-0001-x.md"]) {
      expect(ADR_FILENAME_RE.test(name)).toBe(true);
    }
    for (const name of ["README.md", "PROCESS.md", "notes-v2.md"]) {
      expect(ADR_FILENAME_RE.test(name)).toBe(false);
    }
  });
});
