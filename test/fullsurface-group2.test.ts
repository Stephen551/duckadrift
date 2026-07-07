import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";
import { detectDialect } from "../src/adr/dialect.js";
import type { AdrSection } from "../src/adr/types.js";

// Full-surface adversarial pass — GROUP 2 (isolated fixes). Gate bypasses, a
// false negative, and a dialect over-detection. Each fixture runs the engine,
// red on 5d0e449. The baseRef command injection (B-3) is verified separately by
// a shell-level repro (test/action/baseref-injection-repro.mjs).

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-fullsurface-g2");

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
const governedAdr = (n: string, governs: string[]) =>
  `---\nstatus: accepted\ngoverns:\n${governs.map((g) => `  - "${g}"`).join("\n")}\n---\n\n# ADR-${n}\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`;
const prContext = (changedFiles: string[], prBody: string) =>
  JSON.stringify({ changedFiles, commitMessage: "change", prBody });

const d1 = (dir: string) => runSingleCheck(dir, "D1").filter((f) => f.check === "D1");
const d5 = (dir: string) => runSingleCheck(dir, "D5").filter((f) => f.check === "D5");

describe("GROUP 2 — isolated fixes", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("B-4: a suffix-matching filename does not count as 'the PR modified the ADR' (exact identity)", () => {
    // `backup-0001-a.md`.endsWith(`0001-a.md`) let the gate be skipped for an
    // unrelated file, so a real governed change slipped through.
    const dir = writeRepo({
      "docs/adr/0001-a.md": governedAdr("0001", ["src/**"]),
      "pr-context.json": prContext(["src/auth.ts", "backup-0001-a.md"], "no override"),
    });
    const claims = d5(dir).map((f) => f.claim);
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("src/auth.ts");
  });

  it("B-5: an ADR-ACK mention buried in prose does not ack; a trailer on its own line does", () => {
    const proseAck = writeRepo({
      "docs/adr/0001-a.md": governedAdr("0001", ["src/**"]),
      "pr-context.json": prContext(["src/auth.ts"], "We considered the ADR-ACK: 1 path but chose not to."),
    });
    expect(d5(proseAck).length).toBe(1); // prose mention no longer acks → gate fires

    const trailerAck = writeRepo({
      "docs/adr/0001-a.md": governedAdr("0001", ["src/**"]),
      "pr-context.json": prContext(["src/auth.ts"], "Change auth handling.\n\nADR-ACK: 1\n"),
    });
    expect(d5(trailerAck)).toEqual([]); // a real trailer still acks
  });

  it("B-6: a governed dotfile path is matched (minimatch { dot: true }), not silently skipped", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": governedAdr("0001", ["**/*"]),
      "pr-context.json": prContext([".github/workflows/ci.yml"], "no override"),
    });
    const claims = d5(dir).map((f) => f.claim);
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain(".github/workflows/ci.yml");
  });

  it("B-7: a genuinely per-team log (numbers reused across dirs) gets per-directory gap detection", () => {
    // The namespacing signal is a number reused across directories: 0001 appears
    // in both team-a and team-b, so the log numbers per-team and team-a's local
    // sequence {0001, 0003} is genuinely missing 0002. Without the signal — one
    // global sequence foldered by topic, like edgex — gaps stay global (no FP).
    const dir = writeRepo({
      "docs/adr/team-a/0001-a.md": adr("0001"),
      "docs/adr/team-a/0003-c.md": adr("0003"),
      "docs/adr/team-b/0001-b.md": adr("0001"),
      "docs/adr/team-b/0002-b.md": adr("0002"),
      ".duckadrift.yml": "numbering_gaps: fail\n",
    });
    const gaps = d1(dir).filter((f) => /skips? 0002/.test(f.claim));
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.advisory).toBeUndefined(); // numbering_gaps: fail → fact-tier

    // Control: the same disjoint shape WITHOUT cross-dir reuse (one global
    // sequence in folders) must NOT flag a per-directory gap — the edgex FP class.
    const globalInFolders = writeRepo({
      "docs/adr/core/0001-a.md": adr("0001"),
      "docs/adr/api/0002-b.md": adr("0002"),
      "docs/adr/core/0003-c.md": adr("0003"),
      ".duckadrift.yml": "numbering_gaps: fail\n",
    });
    expect(d1(globalInFolders).filter((f) => /skips?/.test(f.claim))).toEqual([]);
  });

  it("B-11: a single MADR marker in an otherwise-Nygard ADR does not trip madr detection", () => {
    // Direct on the primitive: one `## Considered Options` heading alongside the
    // four Nygard markers must detect nygard, not madr (which would emit spurious
    // "missing Context And Problem Statement / Decision Outcome" advisories).
    const sections: AdrSection[] = [
      { heading: "ADR-1", level: 1, body: "" },
      { heading: "Status", level: 2, body: "Accepted" },
      { heading: "Context", level: 2, body: "" },
      { heading: "Decision", level: 2, body: "" },
      { heading: "Consequences", level: 2, body: "" },
      { heading: "Considered Options", level: 2, body: "" },
    ];
    expect(detectDialect(sections)).toBe("nygard");

    // And behaviorally, through D1: no spurious missing-section advisory.
    const dir = writeRepo({
      "docs/adr/0001-a.md":
        "# ADR-1\n\n## Status\nAccepted\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n\n## Considered Options\n- a\n- b\n",
    });
    const missing = d1(dir).filter((f) => /section found|missing the required/.test(f.claim));
    expect(missing).toEqual([]);
  });
});
