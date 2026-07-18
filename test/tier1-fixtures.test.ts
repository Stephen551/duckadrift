// Tier 1 fixture-corpus integrity — STRUCTURAL assertions only. This is the
// Tier 1 analog of test/tier0-fixtures.test.ts and, like it, it is NOT a
// behavioral red-check target: it proves the corpus's shape (manifests parse,
// declared files exist, the S4 invariants hold, every fixture root is Tier 0
// clean), never that any S-check catches anything. The behavioral assertions
// land with the checks themselves in M3.3 — do not point a red-check at this
// file later.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import { runAllTierZeroChecks } from "../src/checks/index.js";
import { listFixtureDirs } from "./helpers/fixture-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1_DIR = join(__dirname, "fixtures", "tier1");

// harness-proof holds the hand-seeded recording for tier1-harness.test.ts,
// pipeline-proof holds the M3.2 pipeline's end-to-end fixture (test-only check
// + recording, driven by tier1-runner.test.ts), and transport-proof holds the
// ADR-0044 claude-code recording proof (tier1-transport.test.ts): proof
// fixtures, not S-check repo fixtures, no manifest.json, not part of the
// S-check corpus contract.
const PROOF_FIXTURES = new Set(["harness-proof", "pipeline-proof", "transport-proof"]);
const REPO_FIXTURES = listFixtureDirs(TIER1_DIR).filter((name) => !PROOF_FIXTURES.has(name));

const S4_FIXTURE = "s4-recurring-revision";
const CLEAN_BASELINE = "clean-baseline";

function fixtureRoot(name: string): string {
  return join(TIER1_DIR, name);
}

function loadManifest(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtureRoot(name), "manifest.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

function adrDirOf(name: string): string {
  return join(fixtureRoot(name), "docs", "adr");
}

function adrFilesOf(name: string): string[] {
  return readdirSync(adrDirOf(name))
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort();
}

function adrContent(name: string, file: string): string {
  return readFileSync(join(adrDirOf(name), file), "utf-8");
}

function adrNumberOf(file: string): number {
  return Number.parseInt(file.slice(0, 4), 10);
}

describe("Tier 1 fixture corpus: manifests and declared files", () => {
  it("has the six repo fixtures", () => {
    expect(REPO_FIXTURES.sort()).toEqual([
      "clean-baseline",
      "s1-contradiction",
      "s2-code-vs-decision",
      "s3-unrecorded-decision",
      "s4-recurring-revision",
      "s5-decay",
    ]);
  });

  for (const name of REPO_FIXTURES) {
    it(`${name}: manifest parses and every declared ADR exists`, () => {
      const manifest = loadManifest(name);
      const adrs = manifest.adrs;
      expect(Array.isArray(adrs)).toBe(true);
      expect((adrs as string[]).length).toBeGreaterThan(0);
      for (const adr of adrs as string[]) {
        expect(existsSync(join(adrDirOf(name), adr)), `${name}: declared ADR ${adr} missing`).toBe(
          true
        );
      }
    });

    it(`${name}: pr-context.json, where present, is valid JSON with changedFiles`, () => {
      const prContextPath = join(fixtureRoot(name), "pr-context.json");
      if (!existsSync(prContextPath)) return;
      const prContext = JSON.parse(readFileSync(prContextPath, "utf-8")) as Record<string, unknown>;
      expect(Array.isArray(prContext.changedFiles)).toBe(true);
      expect((prContext.changedFiles as unknown[]).length).toBeGreaterThan(0);
      for (const file of prContext.changedFiles as unknown[]) {
        expect(typeof file).toBe("string");
      }
    });
  }

  it("s2: the manifest's violating file exists in the fixture tree", () => {
    const expected = loadManifest("s2-code-vs-decision").expected_s2 as { file: string };
    expect(existsSync(join(fixtureRoot("s2-code-vs-decision"), expected.file))).toBe(true);
  });
});

describe("S4 fixture invariants (the 0040–0043 specimen)", () => {
  const manifest = loadManifest(S4_FIXTURE);
  const files = adrFilesOf(S4_FIXTURE);

  it("has exactly four ADRs and the manifest matches the directory", () => {
    expect(files).toHaveLength(4);
    expect([...(manifest.adrs as string[])].sort()).toEqual(files);
    const expected = manifest.expected_s4 as { revision_count: number; resolved: boolean };
    expect(expected.revision_count).toBe(4);
    expect(expected.resolved).toBe(false);
  });

  it("all four are Accepted (loose-dialect bold status line)", () => {
    for (const file of files) {
      expect(adrContent(S4_FIXTURE, file), `${file}: not Accepted`).toMatch(
        /^\*\*Status:\*\*\s+Accepted/m
      );
    }
  });

  it("each of 0041–0043 references at least one earlier member of the set", () => {
    for (const file of files) {
      const number = adrNumberOf(file);
      if (number === 40) continue;
      const content = adrContent(S4_FIXTURE, file);
      const earlier = files.map(adrNumberOf).filter((n) => n < number);
      const referencesEarlier = earlier.some((n) => new RegExp(`ADR\\s*00${n}`).test(content));
      expect(referencesEarlier, `${file}: no reference to an earlier member`).toBe(true);
    }
  });

  it("all four name the bridge-vs-weld primitive while none resolves it", () => {
    expect(manifest.primitive).toContain("bridge");
    expect(manifest.primitive).toContain("weld");
    for (const file of files) {
      const content = adrContent(S4_FIXTURE, file);
      expect(content, `${file}: primitive's bridge half missing`).toMatch(/bridge/i);
      expect(content, `${file}: primitive's weld half missing`).toMatch(/weld/i);
      // Every member parks, banks, or defers — none resolves the primitive.
      expect(content, `${file}: no park/bank/defer disposition found`).toMatch(/park|bank|defer/i);
    }
  });

  it("the four surface topics are distinct (kern, placement, height, eye-body)", () => {
    const titles = files.map((f) => adrContent(S4_FIXTURE, f).split("\n")[0]!);
    expect(titles[0]).toMatch(/connect-kern/i);
    expect(titles[1]).toMatch(/placement, not a per-pair kern/i);
    expect(titles[2]).toMatch(/height normalization/i);
    expect(titles[3]).toMatch(/eye-body placement/i);
  });
});

describe("clean-baseline negative control", () => {
  const files = adrFilesOf(CLEAN_BASELINE);

  it("has four Accepted ADRs", () => {
    expect(files).toHaveLength(4);
    for (const file of files) {
      expect(adrContent(CLEAN_BASELINE, file)).toMatch(/^status: accepted$/m);
    }
  });

  it("has no refines-chain — no member references another member", () => {
    const numbers = files.map(adrNumberOf);
    for (const file of files) {
      const content = adrContent(CLEAN_BASELINE, file);
      for (const other of numbers) {
        if (other === adrNumberOf(file)) continue;
        expect(
          new RegExp(`ADR[- ]?000${other}`).test(content),
          `${file}: references ADR-000${other}`
        ).toBe(false);
      }
    }
  });

  it("shares no primitive phrase with the S4 specimen", () => {
    for (const file of files) {
      expect(adrContent(CLEAN_BASELINE, file)).not.toMatch(/bridge|weld/i);
    }
  });
});

describe("Tier 0 cleanliness: every fixture root checks clean", () => {
  // Runs the engine in-process, without a PR context — the same inputs as the
  // CLI's plain `check <root>` (the CLI reads a PR context only via
  // --pr-context). Asserting zero findings is STRICTER than exit 0: advisory
  // findings also exit 0, but this corpus intends no Tier 0 finding of any
  // tier. s2's pr-context.json deliberately describes a governed-path touch
  // that trips Tier 0's D5 when applied — that is the S2 scenario's
  // deterministic cousin, exercised when S2 lands in M3.3, not part of the
  // corpus's at-rest cleanliness.
  for (const name of REPO_FIXTURES) {
    it(`${name}: zero Tier 0 findings, zero unrecognized files`, () => {
      const ctx = loadAdrLog(fixtureRoot(name));
      expect(runAllTierZeroChecks(ctx)).toEqual([]);
      expect(ctx.unrecognizedFiles).toEqual([]);
    });
  }
});
