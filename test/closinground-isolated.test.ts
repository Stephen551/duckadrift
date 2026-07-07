import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";
import { loadConfig } from "../src/config/load.js";

// Closing round — the isolated fixes: D1 declared-numbering scoping (NEW-C) and
// the two config-load robustness crashes (NEW-E, NEW-F). Behavioral fixtures,
// red on e959fd3. The D5 git-quoting FP (NEW-B) is verified by a shell repro
// (test/action/quotepath-repro.mjs).

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-closinground-iso");

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
const d1 = (dir: string) => runSingleCheck(dir, "D1").filter((f) => f.check === "D1");

describe("Workstream D — declared numbering bypasses the namespacing gate (NEW-C)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("NEW-C: a DECLARED `numbering: per-directory` forces per-dir gaps even with no cross-dir reuse", () => {
    // Auto/undeclared reuse-gating ignored a declared per-directory scope, so with
    // team-b filling the global hole team-a's real 0002 gap was missed.
    const dir = writeRepo({
      "docs/adr/team-a/0001-a.md": adr("0001"),
      "docs/adr/team-a/0003-c.md": adr("0003"),
      "docs/adr/team-b/0002-b.md": adr("0002"),
      ".duckadrift.yml": "numbering: per-directory\nnumbering_gaps: fail\n",
    });
    const gaps = d1(dir).filter((f) => /skips? 0002/.test(f.claim));
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.advisory).toBeUndefined();
  });

  it("NEW-C HARD control (B-7 edgex shape): auto/undeclared, one global sequence in folders, stays global — 0 gap FP", () => {
    const dir = writeRepo({
      "docs/adr/core/0001-a.md": adr("0001"),
      "docs/adr/api/0002-b.md": adr("0002"),
      "docs/adr/core/0003-c.md": adr("0003"),
      ".duckadrift.yml": "numbering_gaps: fail\n", // numbering NOT declared → reuse-gated
    });
    expect(d1(dir).filter((f) => /skips?/.test(f.claim))).toEqual([]);
  });
});

describe("Workstream E — config load hardened (NEW-E, NEW-F)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("NEW-E: a directory named `.duckadrift.yml` is ignored (defaults), not an EISDIR crash", () => {
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001") });
    mkdirSync(join(dir, ".duckadrift.yml", "nested"), { recursive: true }); // a DIRECTORY of that name
    expect(loadConfig(dir)).toEqual({});
  });

  it("NEW-F: malformed YAML is a loud SetupError (exit 2), not an uncaught throw or silent default", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      ".duckadrift.yml": "dialect: [\n", // unterminated flow sequence
    });
    expect(() => loadConfig(dir)).toThrow(/invalid \.duckadrift\.yml/);
  });
});
