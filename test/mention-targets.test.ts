import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-mention-targets");

// FIX 2 (v0.1.4, clause-A pre-publish): D3 skips `@handle` author-mentions
// (v0.1.1) but still existence-checked a bare `@` — an unfilled attribution
// slot, `[Name](@)` — and false-failed it as an unresolved reference. Found
// running opendatahub-io/architecture-decision-records, whose author tables
// carry `[Chris Sams](@)`. A target beginning with `@` is a GitHub author
// mention, never a repo-relative path. The mention rule now also matches the
// empty handle, so a bare `@` is skipped like `@handle`.
//
// Narrow by design (director ruling): only mention-shaped `@` targets are
// skipped. A scoped-package-style target like `@scope/name` carries a `/`, is
// not a mention, and stays existence-checked so a dangling package reference is
// still caught — the deliberate v0.1.1 behavior this fix must not regress.

function writeAdr(dir: string, name: string, body: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "docs", "adr"), { recursive: true });
  writeFileSync(join(dir, "docs", "adr", name), body);
}

function d3Findings(dir: string): string[] {
  return runSingleCheck(dir, "D3")
    .filter((f) => f.check === "D3")
    .map((f) => f.claim);
}

describe("FIX 2: D3 skips `@`-mention link targets, bare and handled", () => {
  const dir = join(TMP, "mentions");
  beforeAll(() => {
    // [a] is a bare `@` (the surviving false positive); [b] is a normal handle
    // (already skipped on the shipped code). Neither is a repo path.
    writeAdr(
      dir,
      "0001-authors.md",
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nAuthors: [Chris Sams](@) and [Vaishnavi Hire](@VaishnaviHire)\n\n## Decision\ny\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("does not flag a bare `@` or an `@handle` as an unresolved reference", () => {
    // Red on the shipped code: the bare `@` produced a D3 dangling finding.
    // Green after: both are recognized as mentions and skipped.
    expect(d3Findings(dir)).toEqual([]);
  });
});

describe("FIX 2 control: a genuinely dangling repo link still fails", () => {
  const dir = join(TMP, "dangling");
  beforeAll(() => {
    writeAdr(
      dir,
      "0001-dangle.md",
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nSee [x](./missing.md)\n\n## Decision\ny\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("still flags a real dangling in-repo link after the mention skip", () => {
    const claims = d3Findings(dir);
    expect(claims.length).toBe(1);
    expect(claims[0]).toMatch(/does not resolve at HEAD/);
  });
});

describe("FIX 2 guard: a scoped-package-style `@scope/name` target stays checked", () => {
  const dir = join(TMP, "scoped");
  beforeAll(() => {
    // `@scope/name` has a `/`, is not a mention, and points at nothing in the
    // repo — it must still be flagged. Locks in the narrow skip: the fix must
    // not blanket-skip everything starting with `@`.
    writeAdr(
      dir,
      "0001-scoped.md",
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nUses [pkg](@acme/does-not-exist)\n\n## Decision\ny\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("still flags a dangling scoped-package-style reference", () => {
    const claims = d3Findings(dir);
    expect(claims.length).toBe(1);
    expect(claims[0]).toMatch(/does not resolve at HEAD/);
  });
});
