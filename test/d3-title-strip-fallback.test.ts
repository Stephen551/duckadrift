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

  it("surfaces `my folder (v2)` as an advisory ambiguity, not a silent pass (red before fix)", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [d](my folder (v2))"),
      "docs/adr/my folder (v2)/keep.txt": "x\n",
    });
    const findings = d3full(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.advisory).toBe(true);
    expect(findings[0]!.claim).toContain("does not resolve at HEAD — but a file named");
    expect(findings[0]!.claim).toContain("my folder (v2)");
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

  // P1 (Codex): a `missing.md (title)` link with a decoy file `missing.md (title)`
  // and NO `missing.md` used to resolve SILENTLY on the raw form — a genuinely
  // broken link sent to /dev/null (Pact violation). Now advisory: surfaced, not
  // failed, not hidden.
  it("P1: a broken link with a decoy raw-form file is advisory, not a silent pass (red before fix)", () => {
    const dir = writeRepo({
      "docs/adr/0001-x.md": adr("See [broken](missing.md (title))"),
      "docs/adr/missing.md (title)": "x\n",
    });
    const findings = d3full(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.advisory).toBe(true);
    expect(findings[0]!.claim).toContain("missing.md");
    expect(findings[0]!.claim).toContain("missing.md (title)");
  });

  it("P1 control: the same link with NO decoy file is a failing dangling finding", () => {
    const dir = writeRepo({ "docs/adr/0001-x.md": adr("See [broken](missing.md (title))") });
    const findings = d3full(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.advisory).toBeUndefined();
    expect(findings[0]!.claim).toContain("missing.md");
  });
});

// GM1 (Gemini, regression): a site-relative link ending in `(v2)` whose real file
// lives elsewhere (`docs/other/my folder (v2).md`, not in the ADR dir) HARD-FAILED
// on this branch — findByBasename got only the normalized `my folder` and missed
// the raw basename. It was advisory on v0.1.4. Step 4 now tries the raw basename
// too, restoring the site-relative advisory.
describe("GM1: D3 site-relative match considers the raw basename too", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  it("finds `my folder (v2).md` elsewhere as an advisory site-relative match (red before fix)", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [d](my folder (v2))"),
      "docs/other/my folder (v2).md": "# elsewhere\n",
    });
    const findings = d3full(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.advisory).toBe(true);
    expect(findings[0]!.claim).toContain("possibly site-relative — found at");
    expect(findings[0]!.claim).toContain("docs/other/my folder (v2).md");
  });
});
