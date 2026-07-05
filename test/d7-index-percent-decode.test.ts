import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-index-percent-decode");

// C1 (v0.1.5 mini-round): D3 percent-decodes a link target ("%20" -> space) but
// D7 did not, so an index entry `0001-a%20b.md` pointing at the real file
// `0001-a b.md` was flagged twice — the entry "does not exist" AND the file
// "not listed." Both now go through the one shared decodeTarget, so the index
// and the ADR-body checks resolve the same file identically.

const adr = (n: string) =>
  `---\nstatus: accepted\n---\n\n# ADR-${n}\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`;
function writeRepo(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, "docs", "adr"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, "docs", "adr", rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}
const d7 = (dir: string) => runSingleCheck(dir, "D7").filter((f) => f.check === "D7").map((f) => f.claim);

describe("C1: D7 percent-decodes index entries like D3 does", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("does not flag `0001-a%20b.md` when the file `0001-a b.md` exists (red before fix)", () => {
    const dir = writeRepo({
      "README.md": "# Index\n\n- [A](0001-a%20b.md)\n- [B](0002-b.md)\n",
      "0001-a b.md": adr("0001"),
      "0002-b.md": adr("0002"),
    });
    expect(d7(dir)).toEqual([]);
  });

  it("control: a genuinely missing index target still fires", () => {
    const dir = writeRepo({
      "README.md": "# Index\n\n- [M](0001-missing.md)\n- [B](0002-b.md)\n",
      "0002-b.md": adr("0002"),
    });
    const claims = d7(dir);
    expect(claims.some((c) => c.includes("0001-missing.md") && /does not exist/.test(c))).toBe(true);
  });
});
