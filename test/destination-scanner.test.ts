import { describe, expect, it } from "vitest";
import { extractLinkTargets, normalizeLinkDestination } from "../src/adr/parse.js";

// The §4 master extraction contract for the spec-compliant CommonMark parser
// (mdast / micromark) that replaced the hand-rolled scanner. Every row is a
// test. The scanner leaked three ways on the standing gate's probe (NEW-1/2/3);
// the parser is correct on the grammar by construction. Two tool conventions
// sit on top: the escape-aware `#fragment` strip (constraint A) and the deferred
// space-bearing bare path (constraint B — dropped, wrap in angle brackets).

const one = (input: string) => extractLinkTargets(input).map((l) => l.target);

describe("§4 extraction contract — extractLinkTargets", () => {
  const rows: Array<[string, string[]]> = [
    ["[t](../../foo\\)bar.md)", ["../../foo)bar.md"]], // escaped ) literal (F1)
    ["[t](../../foo\\#bar.md)", ["../../foo#bar.md"]], // escaped # literal, not a fragment (F2)
    ["[t](../../foo\\#bar.md#sec)", ["../../foo#bar.md"]], // constraint A
    ["[t](foo.md#section)", ["foo.md"]], // plain fragment stripped
    ["[t](../../a(b(c)d).md)", ["../../a(b(c)d).md"]], // nested parens (F3/G4B)
    ["[l](<foo\\>bar>)", ["foo>bar"]], // angle, escaped > (G4A)
    ["[x](<missing.md)", []], // unclosed angle → no link (F4)
    ["[see [ADR] here](0001.md)", ["0001.md"]], // NEW-1 bracketed label
    ["[x](foo(bar.md)", []], // NEW-2 unterminated paren → no link
    ["[t](../../foo\\nbar.md)", ["../../foo\\nbar.md"]], // NEW-3 backslash before non-punct kept
    ["[t](foo\\.bar.md)", ["foo.bar.md"]], // NEW-3 control: backslash before punct
    ["[i](common-config-images/EdgeX 3.x flowchart.png)", []], // constraint B: dropped
    ['[t](path "title")', ["path"]], // title stripped
    ["[t](foo(v2).md)", ["foo(v2).md"]], // versioned filename kept
    ["[l](<https://example.com>)", ["https://example.com"]], // autolink-style; external, skipped by D3 downstream
  ];
  for (const [input, expected] of rows) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(one(input)).toEqual(expected);
    });
  }

  it("REF: a reference-style link resolves via its definition (new capability)", () => {
    expect(one("[t][r]\n\n[r]: 0001-foo.md")).toEqual(["0001-foo.md"]);
  });

  it("an autolink yields its url, not a following parenthesized word (differential catch)", () => {
    // `<url>` is a `link` node but not `[label](dest)`; extraction must use its
    // url, not scan forward to the next `(...)`. edgex-docs ADR-0016 has
    // `<https://…> (registration required)`, which mis-extracted `registration`.
    expect(one("See <https://workbench.example.org/x> (registration required)")).toEqual([
      "https://workbench.example.org/x",
    ]);
  });
});

describe("normalizeLinkDestination: single-destination wrapper", () => {
  it("is escape-aware and title/fragment-stripping", () => {
    expect(normalizeLinkDestination("../../foo\\#bar.md#sec")).toBe("../../foo#bar.md");
    expect(normalizeLinkDestination('path "title"')).toBe("path");
    expect(normalizeLinkDestination("foo(v2).md")).toBe("foo(v2).md");
  });
  it("handles a large adversarial whitespace input in bounded time (S6, parser is linear)", () => {
    const evil = `path${" ".repeat(40_000)}"unterminated`;
    const start = performance.now();
    const out = normalizeLinkDestination(evil);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(out).toBe(""); // not a valid link
  });
});
