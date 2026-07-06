import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-title-strip-fallback");

// G2 (v0.1.5 mini-round): the title-strip that fixed findings 1-2 over-truncated
// a real path — `[d](my folder (v2))`, where a directory named `my folder (v2)`
// exists, normalized to `my folder` and dangled. D3 now retries the raw capture
// on the dangling branch, disambiguating a stripped title from parens that are
// part of a filename by filesystem evidence.

function writeRepo(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}
const adr = (body: string) =>
  `---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\n${body}\n\n## Decision\ny\n\n## Consequences\nz\n`;
const d3full = (dir: string) => runSingleCheck(dir, "D3").filter((f) => f.check === "D3");
const d3 = (dir: string) => d3full(dir).map((f) => f.claim);

describe("G2/P1/GM1: D3 resolution ladder for the `X (suffix)` ambiguity class", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("a space-bearing bare dest `my folder (v2)` is not a valid link — dropped (constraint B deferred)", () => {
    // Re-scoped for the CommonMark parser: `my folder (v2)` has spaces in a bare
    // destination, which strict CommonMark rejects — there is no link, so no
    // finding. The ambiguity-ladder advisory the scanner produced is retired;
    // the LIMITS guidance is to angle-bracket a space-bearing path.
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [d](my folder (v2))"),
      "docs/adr/my folder (v2)/keep.txt": "x\n",
    });
    expect(d3(dir)).toEqual([]);
  });

  it("an angle-bracketed space-bearing path resolves (the constraint-B remedy)", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [d](<my folder (v2)/keep.txt>)"),
      "docs/adr/my folder (v2)/keep.txt": "x\n",
    });
    expect(d3(dir)).toEqual([]);
  });

  it("control: a genuinely missing path still fires", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("See [x](nonexistent.md)") });
    expect(d3(dir).length).toBe(1);
  });

  it("control: a missing path WITH a title still fires (raw form doesn't resolve either)", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr('See [x](nonexistent.md "a title")') });
    expect(d3(dir).length).toBe(1);
  });

  it("control: a real path with a genuine title resolves via the normalized form", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr('See [one](0001-x.md "The Decision")'),
      "docs/adr/0001-x.md": adr("x"),
    });
    expect(d3(dir)).toEqual([]);
  });

  // P1 (Codex): `[broken](missing.md (title))` — the CommonMark parser correctly
  // reads ` (title)` as a paren TITLE over the destination `missing.md`, so a
  // decoy file literally named `missing.md (title)` is irrelevant (a scanner
  // artifact) and the link to `missing.md` is a genuine dangling finding, not a
  // silent pass. The Pact holds by construction: the title is parsed, not guessed.
  it("P1: a paren-title over a missing path is a dangling finding, decoy file ignored", () => {
    const dir = writeRepo({
      "docs/adr/0001-x.md": adr("See [broken](missing.md (title))"),
      "docs/adr/missing.md (title)": "x\n",
    });
    const findings = d3full(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.advisory).toBeUndefined();
    expect(findings[0]!.claim).toContain("missing.md");
  });

  it("P1 control: the same link with NO decoy file is a failing dangling finding", () => {
    const dir = writeRepo({ "docs/adr/0001-x.md": adr("See [broken](missing.md (title))") });
    const findings = d3full(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.advisory).toBeUndefined();
    expect(findings[0]!.claim).toContain("missing.md");
  });
});

// GM1: under the CommonMark parser, `[d](my folder (v2))` is not a valid link
// (space in a bare destination), so nothing is extracted and there is no finding
// — regardless of where a same-named file lives. The site-relative raw-basename
// path is unexercised for space-bearing dests (constraint B); a real
// space-bearing path must be angle-bracketed.
describe("GM1: a space-bearing site-relative dest is dropped, not laddered", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  it("`[d](my folder (v2))` with the file elsewhere yields no finding", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [d](my folder (v2))"),
      "docs/other/my folder (v2).md": "# elsewhere\n",
    });
    expect(d3(dir)).toEqual([]);
  });
});
