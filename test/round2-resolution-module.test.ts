import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

// Round-two adversarial consolidation — the resolution module. Behavioral
// fixtures (run the engine, not the structural validator) isolating each of the
// nine findings across the three residual-primitive classes. Each was confirmed
// red on e86971d and passes on the module.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-round2");

function writeRepo(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}
const adr = (n: string, body: string) =>
  `---\nstatus: accepted\n---\n\n# ADR-${n}\n\n## Context\n${body}\n\n## Decision\ny\n\n## Consequences\nz\n`;
const supersededByPath = (n: string, path: string) =>
  `---\nstatus: superseded\nsuperseded-by: ${path}\n---\n\n# ADR-${n}\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`;
const d3 = (dir: string) => runSingleCheck(dir, "D3").filter((f) => f.check === "D3");
const d7 = (dir: string) => runSingleCheck(dir, "D7").filter((f) => f.check === "D7");
const d2 = (dir: string) => runSingleCheck(dir, "D2").filter((f) => f.check === "D2");

describe("Class 1 — the destination grammar (scanner)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("F1: an escaped `)` is literal — `foo\\)bar.md` resolves, no finding", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "[t](../../foo\\)bar.md)"), "foo)bar.md": "x\n" });
    expect(d3(dir)).toEqual([]);
  });

  it("F2: an escaped `#` is literal, not a fragment — `foo\\#bar.md` resolves, no finding", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "[t](../../foo\\#bar.md)"), "foo#bar.md": "x\n" });
    expect(d3(dir)).toEqual([]);
  });

  it("F3/G4B: a nested-paren target is captured — absent → dangling fires (no silent drop)", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "[t](../../a(b(c)d).md) and [u](../../foo(v2(nested)).md)") });
    const claims = d3(dir).map((f) => f.claim);
    expect(claims.length).toBe(2);
    expect(claims.some((c) => c.includes("a(b(c)d).md"))).toBe(true);
    expect(claims.some((c) => c.includes("foo(v2(nested)).md"))).toBe(true);
  });

  it("F3/G4B control: a present nested-paren target resolves", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "[t](a(b(c)d).md)"), "docs/adr/a(b(c)d).md": "x\n" });
    expect(d3(dir)).toEqual([]);
  });

  it("G4A: angle `\\>` is a literal `>` — the flagged target is `foo>bar`, not the truncated `foo\\`", () => {
    // A file literally named `foo>bar` is illegal on Windows, so assert the
    // engine-observable half: the escaped `>` no longer truncates the target.
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "[l](<../../foo\\>bar>)") });
    const claims = d3(dir).map((f) => f.claim);
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("foo>bar");
    expect(claims[0]).not.toContain("foo\\");
  });

  it("F4: an unclosed `<` angle is not a valid link — no finding (spec parser drops it)", () => {
    // Re-scoped for the CommonMark parser: an unclosed angle is simply not a
    // link, so there is no phantom target and no finding (the scanner's
    // malformed-advisory is retired). §4 contract row: (no link).
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "[x](<missing.md)") });
    expect(d3(dir)).toEqual([]);
  });
});

describe("Parser round — spec-compliant extraction (NEW-1/2/3, reference-style)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("NEW-1: a bracketed label link resolves — not dropped", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "See [the [ADR] doc](0002-b.md)"), "docs/adr/0002-b.md": adr("0002", "x") });
    expect(d3(dir)).toEqual([]);
  });

  it("NEW-3: a backslash before a non-punct char is literal (a file named `a\\nb.md`)", () => {
    // The scanner over-unescaped, turning `a\nb.md` into `anb.md` — a clause-A FP.
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "See [x](a\\nb.md)"), "docs/adr/a\\nb.md": "x\n" });
    expect(d3(dir)).toEqual([]);
  });

  it("reference-style: a broken reference-style link is a dangling finding (new capability)", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "See [the doc][ref]\n\n[ref]: missing.md") });
    const claims = d3(dir).map((f) => f.claim);
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("missing.md");
  });

  it("reference-style: a resolving reference-style link is clean", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "See [the doc][ref]\n\n[ref]: 0002-b.md"), "docs/adr/0002-b.md": adr("0002", "x") });
    expect(d3(dir)).toEqual([]);
  });
});

describe("Class 2 — index-entry matching (D7 through the resolver)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("G1: a path-form index entry `../adr/NNNN-*.md` resolves to the file — listed, no finding", () => {
    const dir = writeRepo({
      "docs/adr/0001-foo.md": adr("0001", "body"),
      "docs/adr/README.md": "# Index\n\n- [l](../adr/0001-foo.md)\n",
    });
    expect(d7(dir)).toEqual([]);
  });

  it("F5: D3 and D7 reach the same disposition on the same `%2F…` target (parity)", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001", "See [b](%2F0002-b.md)"),
      "docs/adr/0002-b.md": adr("0002", "body"),
      "docs/adr/README.md": "# Index\n\n- [a](0001-a.md)\n- [b](%2F0002-b.md)\n",
    });
    // Before the module D3 gave a site-relative advisory while D7 silently
    // resolved via a leading-slash strip — divergence. Now both run the one
    // resolver: D7 counts 0002-b.md as listed (no "not listed" finding), and D3
    // surfaces the same site-relative disposition. Parity = neither diverges.
    expect(d7(dir).some((f) => f.claim.includes("0002-b.md") && /not listed/.test(f.claim))).toBe(false);
    expect(d3(dir).some((f) => f.claim.includes("0002-b.md"))).toBe(true);
  });
});

describe("Class 3 — supersession-reference parsing (D2 through the resolver)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("G3: a path-form supersession ref resolves and drives the graph — a path cycle fires", () => {
    const dir = writeRepo({
      "docs/adr/team-a/0001-foo.md": supersededByPath("0001", "../team-b/0001-bar.md"),
      "docs/adr/team-b/0001-bar.md": supersededByPath("0001", "../team-a/0001-foo.md"),
    });
    const cycles = d2(dir).filter((f) => /cycle/i.test(f.claim));
    expect(cycles.length).toBe(1);
    expect(cycles[0]!.claim).toContain("team-a/");
    expect(cycles[0]!.claim).toContain("team-b/");
  });

  it("G3 control: a broken path supersession ref is reported, never silently dropped", () => {
    const dir = writeRepo({
      "docs/adr/team-a/0001-foo.md": supersededByPath("0001", "../team-z/9999-nope.md"),
    });
    const broken = d2(dir).filter((f) => /does not resolve to an ADR/.test(f.claim));
    expect(broken.length).toBe(1);
    expect(broken[0]!.advisory).toBeUndefined(); // a broken declared reference is a real finding
  });
});
