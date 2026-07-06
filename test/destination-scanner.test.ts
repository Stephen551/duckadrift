import { describe, expect, it } from "vitest";
import { normalizeLinkDestination, scanLinks } from "../src/adr/parse.js";

// Workstream (round-two consolidation): the linear CommonMark destination
// scanner that replaces LINK_RE. This is the §2.1 contract table — one unit
// test per row — proving escaped delimiters, nested parens, and angle-bracket
// validity are handled by construction (F1-F4, G4A, G4B), while the existing
// title/fragment/versioned-paren behavior is preserved.

describe("normalizeLinkDestination: §2.1 contract table", () => {
  const cases: Array<[string, string]> = [
    ["../../foo\\)bar.md", "../../foo)bar.md"], // escaped ) is literal (F1)
    ["../../foo\\#bar.md", "../../foo#bar.md"], // escaped # is literal, not a fragment (F2)
    ["../../a(b(c)d).md", "../../a(b(c)d).md"], // balanced nested parens kept (F3)
    ["foo(v2(nested)).md", "foo(v2(nested)).md"], // arbitrary nesting depth (G4B)
    ["<foo\\>bar>", "foo>bar"], // angle; escaped > is literal; unwrap (G4A)
    ["<foo bar.md>", "foo bar.md"], // angle permits spaces
    ["foo(v2).md", "foo(v2).md"], // versioned filename kept
    ["common-config-images/EdgeX 3.x flowchart.png", "common-config-images/EdgeX 3.x flowchart.png"], // bare path with spaces, no title
    ['path "title"', "path"], // recognizable trailing title stripped
    ["foo.md#section", "foo.md"], // unescaped fragment stripped
    ["foo\\#bar.md#section", "foo#bar.md"], // escaped # kept; only the later unescaped # is the fragment
  ];
  for (const [raw, expected] of cases) {
    it(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, () => {
      expect(normalizeLinkDestination(raw)).toBe(expected);
    });
  }
});

describe("scanLinks: malformed + structural", () => {
  it("an unclosed angle destination is malformed (no phantom target) — F4", () => {
    const links = scanLinks("See [x](<missing.md)");
    expect(links.length).toBe(1);
    expect(links[0]!.malformed).toBe(true);
    expect(links[0]!.target).toBe("");
  });

  it("captures multiple links per line and their line numbers", () => {
    const links = scanLinks("a\n[one](a.md) mid [two](b.md)\n");
    expect(links.map((l) => l.target)).toEqual(["a.md", "b.md"]);
    expect(links.every((l) => l.line === 2)).toBe(true);
  });

  it("a nested-paren target is captured whole (F3/G4B) — no silent drop", () => {
    const links = scanLinks("[t](../../a(b(c)d).md)");
    expect(links.length).toBe(1);
    expect(links[0]!.target).toBe("../../a(b(c)d).md");
    expect(links[0]!.malformed).toBe(false);
  });

  it("rawTarget keeps a trailing title while target strips it (the ladder input)", () => {
    const links = scanLinks("[d](my folder (v2))");
    expect(links[0]!.target).toBe("my folder");
    expect(links[0]!.rawTarget).toBe("my folder (v2)");
  });

  it("`[...]` not followed by `(` is not a link", () => {
    expect(scanLinks("a [ref] to something").length).toBe(0);
  });
});
