import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-decision-section");

// FIX 1 (v0.1.4, clause-A pre-publish): D1's Decision-section matcher accepted
// only the exact heading `## Decision`. A Nygard/loose log that titles the
// section `## Decisions` (plural) — a real, common variant, found in an external
// log during the pre-publish pass — was false-flagged "no Decision section
// found" even though the section is right there. The matcher now accepts
// `Decision` and `Decisions` (case already folded upstream). MADR's canonical
// `## Decision Outcome` was never missed and must stay matched; a genuinely
// absent decision section must still flag (no over-correction into a false
// negative).

// A recognized ADR needs a numbered filename; a single ADR with no index file
// keeps D7 (log/index drift) silent, so runSingleCheck(D1) sees only D1's own
// signal.
function writeAdr(dir: string, name: string, body: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "docs", "adr"), { recursive: true });
  writeFileSync(join(dir, "docs", "adr", name), body);
}

function d1MissingDecision(dir: string): boolean {
  return runSingleCheck(dir, "D1").some(
    (f) => f.check === "D1" && /no .*Decision.* section found|missing the required.*Decision/i.test(f.claim)
  );
}

describe("FIX 1: D1 accepts a `## Decisions` (plural) decision section", () => {
  const dir = join(TMP, "plural");
  beforeAll(() => {
    // Nygard-detected (Context + Consequences headings) with a plural Decisions
    // heading. On the shipped code D1 false-flags a missing Decision section.
    writeAdr(
      dir,
      "0001-plural.md",
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nx\n\n## Decisions\nWe chose Y.\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("does not flag a missing Decision section when the heading is `## Decisions`", () => {
    // Red on the shipped code (the plural heading was unrecognized), green after
    // the alias widening.
    expect(d1MissingDecision(dir)).toBe(false);
  });
});

describe("FIX 1 control: a genuinely absent Decision section still flags", () => {
  const dir = join(TMP, "absent");
  beforeAll(() => {
    // Context + Consequences, no decision section at all — the audit's genuine
    // no-decision ADR (a true positive). Must stay flagged after the fix; proves
    // the widening did not over-correct into a false negative.
    writeAdr(
      dir,
      "0001-absent.md",
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nx\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("still flags an ADR with no Decision or Decisions section", () => {
    expect(d1MissingDecision(dir)).toBe(true);
  });
});

describe("FIX 1 coverage: MADR's canonical `## Decision Outcome` stays matched", () => {
  const dir = join(TMP, "madr");
  beforeAll(() => {
    // MADR-detected (Decision Outcome / Considered Options markers). Its
    // required decision heading is `Decision Outcome`, already matched; confirm
    // the alias change didn't disturb it.
    writeAdr(
      dir,
      "0001-madr.md",
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context and Problem Statement\nx\n\n## Considered Options\na, b\n\n## Decision Outcome\nWe chose a.\n"
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("does not flag a missing decision section for a canonical MADR log", () => {
    expect(d1MissingDecision(dir)).toBe(false);
  });
});
