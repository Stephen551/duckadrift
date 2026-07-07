import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

// Closing round — Workstream A. D7's index handling finishes the parser-swap
// consolidation: it now extracts links via the shared mdast parser (NEW-A,
// multi-line links) and resolves them strictly to the cited path (NEW-D, no
// whole-repo basename fallback). Behavioral fixtures, red on e959fd3.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-closinground-d7");

function writeRepo(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}

const adr = (n: string, body = "x") =>
  `---\nstatus: accepted\n---\n\n# ADR-${n}\n\n## Context\n${body}\n\n## Decision\ny\n\n## Consequences\nz\n`;
const d7 = (dir: string) => runSingleCheck(dir, "D7").filter((f) => f.check === "D7");

describe("Workstream A — D7 index handling, fully consolidated", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("NEW-A: a valid multi-line CommonMark index link is honored, not read as unlisted", () => {
    // The old pre-parse line filter dropped the continuation line of
    // `* [id](\n  path)`, breaking the link; the ADR was then falsely "not listed".
    // A second single-line entry keeps the index recognized (so the zero-entries
    // guard doesn't mask the bug) — on e959fd3, 0001-a.md is reported unlisted.
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      "docs/adr/0002-b.md": adr("0002"),
      "docs/adr/README.md": "# Index\n\n- [ADR 2](0002-b.md)\n* [ADR 1](\n  0001-a.md)\n",
    });
    expect(d7(dir)).toEqual([]);
  });

  it("NEW-A control: a normal single-line index is unaffected", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      "docs/adr/README.md": "# Index\n\n- [ADR 1](0001-a.md)\n",
    });
    expect(d7(dir)).toEqual([]);
  });

  it("NEW-D: a stale entry whose basename matches an ADR at a DIFFERENT path is flagged, not accepted", () => {
    // The whole-repo basename fallback accepted `old/site/path/0001-a.md` as
    // listing 0001-a.md → the stale entry passed clean. Strict path resolution
    // makes it stale and the ADR correctly "not listed."
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      "docs/adr/README.md": "# Index\n\n- [ADR 1](old/site/path/0001-a.md)\n",
    });
    const claims = d7(dir).map((f) => f.claim);
    expect(claims.some((c) => /not listed/.test(c) && c.includes("0001-a.md"))).toBe(true);
  });

  it("NEW-D HARD control (B-2): a valid extensionless entry `[2](0002-b)` -> 0002-b.md stays clean", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      "docs/adr/0002-b.md": adr("0002"),
      "docs/adr/README.md": "# Index\n\n- [ADR 1](0001-a.md)\n- [ADR 2](0002-b)\n",
    });
    expect(d7(dir)).toEqual([]);
  });
});
