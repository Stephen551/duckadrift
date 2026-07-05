import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-d7-consolidation");
const REPO = join(TMP, "repo");
const OUTSIDE = join(TMP, "outside.md");

function reset(): void {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(REPO, "docs", "adr"), { recursive: true });
}
const adr = (n: string) =>
  `---\nstatus: accepted\n---\n\n# ADR-${n}\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`;
const d7 = () => runSingleCheck(REPO, "D7").filter((f) => f.check === "D7").map((f) => f.claim);

// Finding 3 (v0.1.5): D7 re-parsed the index with its own pre-C1 regex that
// truncated `0001-foo(v2).md` at the first paren, so a real parenthesized
// filename that WAS indexed read as "exists but not listed." D7 now uses the
// shared CommonMark parser from parse.ts.
describe("Finding 3: D7 parses a parenthesized filename in an index entry", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  it("does not flag a parens filename that is indexed", () => {
    reset();
    writeFileSync(join(REPO, "docs/adr/README.md"), "# Index\n\n- [a](0001-foo(v2).md)\n- [b](0002-bar.md)\n");
    writeFileSync(join(REPO, "docs/adr/0001-foo(v2).md"), adr("0001"));
    writeFileSync(join(REPO, "docs/adr/0002-bar.md"), adr("0002"));
    expect(d7()).toEqual([]);
  });
  it("control: a parens file present but NOT indexed still fires", () => {
    reset();
    writeFileSync(join(REPO, "docs/adr/README.md"), "# Index\n\n- [b](0002-bar.md)\n");
    writeFileSync(join(REPO, "docs/adr/0001-foo(v2).md"), adr("0001"));
    writeFileSync(join(REPO, "docs/adr/0002-bar.md"), adr("0002"));
    const claims = d7();
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("0001-foo(v2).md");
    expect(claims[0]).toMatch(/not listed in the ADR index/);
  });
});

// Finding 5 (SECURITY, v0.1.5): D7's index-existence check was a raw existsSync
// with no containment, so an index entry pointing outside the repo turned "the
// outside file exists" into a CI pass/fail a fork could read. D7 now uses the
// shared existsWithinRepo, so present-outside and absent-outside are
// indistinguishable.
describe("Finding 5: D7 index existence is repo-contained (no filesystem probe)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  function buildEscapeRepo(): void {
    reset();
    // The index points at a .md ABOVE the repo root (../../../ from docs/adr
    // reaches TMP, the repo's parent), so it escapes under both the adr-dir and
    // repo-root resolutions — a true out-of-repo target, not an in-repo `../`.
    writeFileSync(
      join(REPO, "docs/adr/README.md"),
      "# Index\n\n- [real](0001-real.md)\n- [x](../../../outside.md)\n"
    );
    writeFileSync(join(REPO, "docs/adr/0001-real.md"), adr("0001"));
  }
  it("produces an identical finding whether the outside target exists or not", () => {
    buildEscapeRepo();
    writeFileSync(OUTSIDE, "# outside\n");
    const present = d7();
    rmSync(OUTSIDE, { force: true });
    const absent = d7();
    // No exit-code / finding leak: the two runs are identical.
    expect(present).toEqual(absent);
    expect(present.length).toBe(1);
    expect(present[0]).toMatch(/resolves outside the repository/);
  });
  it("control: an in-repo index target that is genuinely missing still fires", () => {
    reset();
    writeFileSync(join(REPO, "docs/adr/README.md"), "# Index\n\n- [real](0001-real.md)\n- [gone](0099-missing.md)\n");
    writeFileSync(join(REPO, "docs/adr/0001-real.md"), adr("0001"));
    const claims = d7();
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("0099-missing.md");
    expect(claims[0]).toMatch(/does not exist in the directory/);
  });
});
