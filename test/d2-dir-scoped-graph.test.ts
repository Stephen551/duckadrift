import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-d2-dir-graph");

// Finding 4 (v0.1.5): findSupersessionCycles resolved targets dir-scoped
// (ADR-0008) but stored edges keyed by bare number, collapsing identically-
// numbered ADRs in different directories into one graph node — so two unrelated
// one-way per-directory chains (team-a 1->2, team-b 2->1) fabricated a cycle.
// The graph is now keyed by fileName (dir-scoped identity). Its siblings
// (mutual/stale) are re-keyed the same way.

function writeRepo(files: Record<string, string>, config?: string): string {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, "docs", "adr"), { recursive: true });
  if (config) writeFileSync(join(TMP, ".duckadrift.yml"), config);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, "docs", "adr", rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}
const superseded = (n: string, by: number) =>
  `---\nstatus: superseded\nsuperseded-by: ${by}\n---\n\n# ADR-${n}\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`;
const accepted = (n: string) =>
  `---\nstatus: accepted\n---\n\n# ADR-${n}\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`;
const d2cycles = (dir: string) =>
  runSingleCheck(dir, "D2").filter((f) => f.check === "D2" && /cycle/i.test(f.claim)).map((f) => f.claim);

describe("Finding 4: D2 does not conflate per-directory numbering into a cycle", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  it("two one-way per-directory chains produce no cycle finding", () => {
    const dir = writeRepo({
      "team-a/0001-old.md": superseded("0001", 2),
      "team-a/0002-new.md": accepted("0002"),
      "team-b/0001-new.md": accepted("0001"),
      "team-b/0002-old.md": superseded("0002", 1),
    });
    expect(d2cycles(dir)).toEqual([]);
  });
  it("control: a genuine single-directory cycle still fires", () => {
    const dir = writeRepo({
      "0001-a.md": superseded("0001", 2),
      "0002-b.md": superseded("0002", 1),
    });
    const claims = d2cycles(dir);
    expect(claims.length).toBe(1);
    expect(claims[0]).toMatch(/ADR-0001 -> ADR-0002 -> ADR-0001/);
  });
  it("control: a genuine cross-directory cycle under numbering: global still fires", () => {
    const dir = writeRepo(
      {
        "team-a/0001-a.md": superseded("0001", 2),
        "team-b/0002-b.md": superseded("0002", 1),
      },
      "numbering: global\n"
    );
    const claims = d2cycles(dir);
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("team-a/");
    expect(claims[0]).toContain("team-b/");
  });
});
