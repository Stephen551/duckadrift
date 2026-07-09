import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

// Unit coverage for the two D3 refinements (issues #2 and #8). Behavioral: each
// builds a temp tree and runs D3 only, so D1/D7/coverage never enter the picture.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-d3-2-8");

function writeRepo(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}

const adr = (contextBody: string) =>
  `---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\n${contextBody}\n\n## Decision\ny\n\n## Consequences\nz\n`;
const d3 = (dir: string) => runSingleCheck(dir, "D3").filter((f) => f.check === "D3");
const claim0 = (dir: string) => d3(dir)[0]?.claim ?? "";

describe("Issue #2 — email-shaped targets ending in a file extension", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("an email-shaped, extension-ended target that RESOLVES to a real file yields zero findings", () => {
    // `author@notes.md` resolves repo-root-relative to a real file — no finding.
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("Notes in [scratch](author@notes.md)."),
      "author@notes.md": "scratch\n",
    });
    expect(d3(dir)).toEqual([]);
  });

  it("real email TLDs are skipped, not existence-checked (.io, .com not in the extension list)", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("Reviewed by [A](user@company.io) and [B](chris@redhat.com)."),
    });
    expect(d3(dir)).toEqual([]);
  });

  it("an email-shaped, extension-ended target that does NOT resolve surfaces as one advisory", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("Notes in [scratch](author@notes.md).") });
    const findings = d3(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.advisory).toBe(true);
    expect(findings[0]!.claim).toContain("shaped like an email address but ends in `.md`");
  });
});

describe("Issue #8 — basename advisories name every candidate", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  // N+1 files named `shared.md` across single-letter dirs -> N other candidates.
  const treeWith = (dirs: string[]) => {
    const files: Record<string, string> = {
      "docs/adr/0001-a.md": adr("See [the shared file](../../lib/shared)."),
    };
    for (const d of dirs) files[`${d}/shared.md`] = `# ${d}\n`;
    return writeRepo(files);
  };

  it("format contract — 1 candidate: singular `1 other file`", () => {
    const c = claim0(treeWith(["a", "b"]));
    expect(c).toContain("(possibly site-relative — found at `a/shared.md`; 1 other file shares this basename: `b/shared.md`).");
  });

  it("format contract — 2 candidates: plural, both named", () => {
    const c = claim0(treeWith(["a", "b", "c"]));
    expect(c).toContain("found at `a/shared.md`; 2 other files share this basename: `b/shared.md`, `c/shared.md`).");
  });

  it("format contract — 5 candidates: three named plus `and 2 more`", () => {
    const c = claim0(treeWith(["a", "b", "c", "d", "e", "f"]));
    expect(c).toContain(
      "found at `a/shared.md`; 5 other files share this basename: `b/shared.md`, `c/shared.md`, `d/shared.md`, and 2 more)."
    );
  });

  it("candidates are listed lexicographically", () => {
    // Dirs written in non-sorted order; the suffix must still read m then z.
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [x](../../lib/overview)."),
      "zzz/overview.md": "z\n",
      "aaa/overview.md": "a\n",
      "mmm/overview.md": "m\n",
    });
    expect(claim0(dir)).toContain("found at `aaa/overview.md`; 2 other files share this basename: `mmm/overview.md`, `zzz/overview.md`).");
  });

  it("a unique basename yields no suffix — byte-parity with the pre-change claim", () => {
    const c = claim0(treeWith(["a"]));
    expect(c).not.toContain("shares this basename");
    expect(c).toBe("ADR-0001 links to `../../lib/shared`, which does not resolve at HEAD (possibly site-relative — found at `a/shared.md`).");
  });
});
