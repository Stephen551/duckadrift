import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-commonmark-links");

// Findings 1 and 2 (v0.1.5 adversarial consolidation): D3 read the raw link
// destination captured by LINK_RE without CommonMark normalization, so an
// angle-bracketed destination (`<...>`, valid CommonMark, the only way to write
// a local path with spaces) and a destination carrying a link title
// (`path "title"`) were both fact-flagged as unresolved. The shared normalizer
// in parse.ts (feeding parsed.links) fixes both for D3.

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
const d3 = (dir: string) => runSingleCheck(dir, "D3").filter((f) => f.check === "D3").map((f) => f.claim);

describe("Finding 1: D3 resolves an angle-bracketed destination", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  it("does not flag `<local with space.md>` when the file exists", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [d](<../design notes/auth design.md>) and [e](<http://example.com>)."),
      "docs/design notes/auth design.md": "# note\n",
    });
    expect(d3(dir)).toEqual([]); // angle-bracket local (with space) resolves; external is skipped
  });
  it("control: a genuinely missing angle-bracketed local file still fires", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("See [d](<../missing note.md>).") });
    const claims = d3(dir);
    expect(claims.length).toBe(1);
    expect(claims[0]).toMatch(/does not resolve at HEAD/);
  });
});

describe("Finding 2: D3 strips a CommonMark link title", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  it("does not flag `path \"title\"` when the path resolves", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr('Impl in [w](../../src/worker.ts "Worker entrypoint").'),
      "src/worker.ts": "export const x = 1;\n",
    });
    expect(d3(dir)).toEqual([]);
  });
  it("control: a missing path with a title still fires (claim shows the clean path)", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr('Impl in [w](./missing.ts "title").') });
    const claims = d3(dir);
    expect(claims.length).toBe(1);
    expect(claims[0]).toMatch(/does not resolve at HEAD/);
    expect(claims[0]).toContain("missing.ts");
    expect(claims[0]).not.toContain("title"); // the title is not part of the flagged target
  });
});
