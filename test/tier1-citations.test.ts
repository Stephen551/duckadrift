import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/tier1/checks.js";
import { validateCitations } from "../src/tier1/citations.js";

// The citation validator (ADR-0031): deterministic and merciless. The model
// quotes bytes or the citation dies — and every death is counted and named.
// This suite is the attack matrix from the M3.2 handoff.

const DOC_A = "The service reads its configuration once at startup.\nWorkers poll the queue table.";
const DOC_B = "All persistence lives in the embedded file.";

const INPUT: CheckInput = {
  documents: [
    { label: "0001-a.md", path: "docs/adr/0001-a.md", content: DOC_A },
    { label: "0002-b.md", path: "docs/adr/0002-b.md", content: DOC_B },
  ],
};

function finding(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    claim: "The checker assesses a conflict.",
    citations: [{ document: "0001-a.md", quote: "Workers poll the queue table." }],
    consequence: "Something follows.",
    reportedConfidence: 0.6,
    ...overrides,
  };
}

function run(findings: unknown[]) {
  return validateCitations({ findings }, INPUT, "S1");
}

describe("citation validation: acceptance", () => {
  it("accepts a verbatim quote from the named document", () => {
    const verdict = run([finding({})]);
    expect(verdict.accepted).toHaveLength(1);
    expect(verdict.discarded).toHaveLength(0);
    expect(verdict.accepted[0]!.citations).toEqual([
      { document: "0001-a.md", quote: "Workers poll the queue table." },
    ]);
  });

  it("accepts a quote spanning a newline when the bytes match", () => {
    const verdict = run([
      finding({ citations: [{ document: "0001-a.md", quote: "startup.\nWorkers poll" }] }),
    ]);
    expect(verdict.accepted).toHaveLength(1);
  });

  it("normalizes CRLF to LF on both sides — and nothing else", () => {
    const crlfInput: CheckInput = {
      documents: [{ label: "0001-a.md", path: "x", content: DOC_A.replace(/\n/g, "\r\n") }],
    };
    const verdict = validateCitations(
      { findings: [finding({ citations: [{ document: "0001-a.md", quote: "startup.\nWorkers poll" }] })] },
      crlfInput,
      "S1"
    );
    expect(verdict.accepted).toHaveLength(1);
  });

  it("deduplicates identical citations, keeping one", () => {
    const citation = { document: "0001-a.md", quote: "Workers poll the queue table." };
    const verdict = run([finding({ citations: [citation, { ...citation }] })]);
    expect(verdict.accepted[0]!.citations).toHaveLength(1);
  });

  it("does NOT collapse different citations whose document+quote concatenations collide", () => {
    // The dedup key's NUL separator exists for exactly this: "a"+"bc" and
    // "ab"+"c" concatenate identically, but they are different citations and
    // both must survive.
    const collisionInput: CheckInput = {
      documents: [
        { label: "a", path: "docs/a.md", content: "bc is in this one." },
        { label: "ab", path: "docs/ab.md", content: "c is in this one." },
      ],
    };
    const verdict = validateCitations(
      {
        findings: [
          finding({
            citations: [
              { document: "a", quote: "bc" },
              { document: "ab", quote: "c" },
            ],
          }),
        ],
      },
      collisionInput,
      "S1"
    );
    expect(verdict.accepted).toHaveLength(1);
    expect(verdict.accepted[0]!.citations).toEqual([
      { document: "a", quote: "bc" },
      { document: "ab", quote: "c" },
    ]);
  });

  it("keeps surviving citations and drops failed ones on the same finding", () => {
    const verdict = run([
      finding({
        citations: [
          { document: "0001-a.md", quote: "Workers poll the queue table." },
          { document: "0001-a.md", quote: "fabricated text" },
        ],
      }),
    ]);
    expect(verdict.accepted).toHaveLength(1);
    expect(verdict.accepted[0]!.citations).toHaveLength(1);
  });
});

describe("citation validation: fabrications die", () => {
  it("fabricated quote → quote-not-found", () => {
    const verdict = run([finding({ citations: [{ document: "0001-a.md", quote: "This never appears." }] })]);
    expect(verdict.discarded).toEqual([
      { check: "S1", claim: "The checker assesses a conflict.", reason: "quote-not-found" },
    ]);
  });

  it("near-miss: one character off → dies", () => {
    const verdict = run([
      finding({ citations: [{ document: "0001-a.md", quote: "Workers poll the queue table," }] }),
    ]);
    expect(verdict.discarded[0]!.reason).toBe("quote-not-found");
  });

  it("near-miss: case-folded → dies", () => {
    const verdict = run([
      finding({ citations: [{ document: "0001-a.md", quote: "workers poll the queue table." }] }),
    ]);
    expect(verdict.discarded[0]!.reason).toBe("quote-not-found");
  });

  it("near-miss: whitespace-collapsed → dies", () => {
    const spaced: CheckInput = {
      documents: [{ label: "0001-a.md", path: "x", content: "Workers  poll the queue table." }],
    };
    const verdict = validateCitations(
      { findings: [finding({})] },
      spaced,
      "S1"
    );
    expect(verdict.discarded[0]!.reason).toBe("quote-not-found");
  });

  it("quote from the wrong document → dies (byte-exists elsewhere is not evidence)", () => {
    const verdict = run([
      finding({ citations: [{ document: "0002-b.md", quote: "Workers poll the queue table." }] }),
    ]);
    expect(verdict.discarded[0]!.reason).toBe("quote-not-found");
  });

  it("unknown document label → unknown-document", () => {
    const verdict = run([
      finding({ citations: [{ document: "0009-ghost.md", quote: "Workers poll the queue table." }] }),
    ]);
    expect(verdict.discarded[0]!.reason).toBe("unknown-document");
  });

  it("envelope text quoted as if from a document → dies", () => {
    const verdict = run([
      finding({
        citations: [{ document: "0001-a.md", quote: '===DOCUMENT label="0001-a.md" path="docs/adr/0001-a.md"===' }],
      }),
    ]);
    expect(verdict.discarded[0]!.reason).toBe("quote-not-found");
  });

  it("empty quote → quote-not-found", () => {
    const verdict = run([finding({ citations: [{ document: "0001-a.md", quote: "" }] })]);
    expect(verdict.discarded[0]!.reason).toBe("quote-not-found");
  });

  it("the full-document quote (over 2000 chars) → quote-not-found", () => {
    const huge = "x".repeat(2001);
    const hugeInput: CheckInput = {
      documents: [{ label: "0001-a.md", path: "x", content: huge }],
    };
    const verdict = validateCitations(
      { findings: [finding({ citations: [{ document: "0001-a.md", quote: huge }] })] },
      hugeInput,
      "S1"
    );
    expect(verdict.discarded[0]!.reason).toBe("quote-not-found");
  });
});

describe("citation validation: shape defects", () => {
  it("zero citations → no-citations", () => {
    const verdict = run([finding({ citations: [] })]);
    expect(verdict.discarded[0]!.reason).toBe("no-citations");
  });

  it("missing citations field → no-citations", () => {
    const { citations: _unused, ...rest } = finding({});
    const verdict = run([rest]);
    expect(verdict.discarded[0]!.reason).toBe("no-citations");
  });

  it("confidence out of range is never clamped — the finding dies as malformed", () => {
    for (const bad of [1.5, -0.1, Number.NaN, "0.6", undefined]) {
      const verdict = run([finding({ reportedConfidence: bad })]);
      expect(verdict.accepted).toHaveLength(0);
      expect(verdict.discarded[0]!.reason).toBe("malformed");
    }
  });

  it("missing claim or consequence → malformed", () => {
    expect(run([finding({ claim: "" })]).discarded[0]!.reason).toBe("malformed");
    expect(run([finding({ consequence: undefined })]).discarded[0]!.reason).toBe("malformed");
  });

  it("prose where the findings array should be → one loud malformed discard, no throw", () => {
    const verdict = validateCitations("Here are my findings: everything looks fine.", INPUT, "S1");
    expect(verdict.accepted).toHaveLength(0);
    expect(verdict.discarded).toEqual([
      { check: "S1", claim: "(unparseable response)", reason: "malformed" },
    ]);
  });

  it("a non-object entry in the array → malformed, siblings still validate", () => {
    const verdict = run(["not a finding", finding({})]);
    expect(verdict.accepted).toHaveLength(1);
    expect(verdict.discarded[0]!.reason).toBe("malformed");
  });
});
