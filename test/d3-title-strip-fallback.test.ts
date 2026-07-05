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
const d3 = (dir: string) => runSingleCheck(dir, "D3").filter((f) => f.check === "D3").map((f) => f.claim);

describe("G2: D3 does not over-truncate a real parenthesized path", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("resolves `my folder (v2)` when the directory exists (regression, red before fix)", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("See [d](my folder (v2))"),
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
});
