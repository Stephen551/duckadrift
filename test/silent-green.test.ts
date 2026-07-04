import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildErrorReport } from "../src/report/write.js";
import { executeReport } from "../src/cli/report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-silent-green");

// The silent-green fix (ADR-0013). Before it, any crash mid-scan wrote no
// report, and the Action read the absence as failing-count=0 and passed green
// — the exact silent stand-down the Pact forbids. These tests pin the fix:
// an incomplete scan produces a LOUD failing report, never a missing one.

describe("S0: buildErrorReport (the failing-report mechanism)", () => {
  it("marks the run failed: failingCount=1, incomplete, no spurious findings", () => {
    const { json } = buildErrorReport("something threw");
    // failingCount drives the Action's red/green decision — an incomplete
    // scan must read as failing, never as a clean zero.
    expect(json.failingCount).toBe(1);
    expect(json.incomplete).toBe(true);
    // tier0Findings stays empty so the annotation emitter has nothing bogus
    // to render — the failure is signalled by failingCount + incomplete only.
    expect(json.tier0Findings).toEqual([]);
    expect(json.error).toBe("something threw");
  });

  it("neutralizes backticks in the error message so the error report isn't itself an injection surface", () => {
    const { markdown, json } = buildErrorReport("bad `path` www.evil.example `x");
    expect(markdown).not.toContain("`");
    expect(json.error).not.toContain("`");
  });

  it("the markdown states plainly that the scan did not complete", () => {
    const { markdown } = buildErrorReport("boom");
    expect(markdown).toMatch(/scan did not complete|did not finish scanning/i);
  });
});

// Behavioral proof against a real crash trigger. A broken symlink under the
// ADR tree makes the walker's statSync throw (this is red on v0.1.0: no report
// written -> Action passes green). Point-in-time: bucket 2's S2 will make the
// walker tolerate symlinks, at which point this trigger stops crashing and the
// test is retargeted in S2's PR. The mechanism unit tests above are the
// permanent guard.
describe("S0: a crash writes a failing report, never a missing one", () => {
  let symlinkOk = false;
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, "docs", "adr"), { recursive: true });
    writeFileSync(
      join(TMP, "docs", "adr", "0001-ok.md"),
      "---\nstatus: accepted\n---\n# ADR 0001\n\n## Context\nx\n\n## Decision\ny\n"
    );
    try {
      symlinkSync(join(TMP, "definitely", "missing"), join(TMP, "docs", "adr", "0002-broken.md"), "file");
      symlinkOk = true;
    } catch {
      symlinkOk = false;
    }
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("crash -> failing report.json (skips loudly if this OS can't make a symlink)", () => {
    if (!symlinkOk) {
      console.warn(
        "S0 behavioral test SKIPPED: this environment cannot create a symlink. " +
          "The buildErrorReport unit tests above still guard the mechanism."
      );
      return;
    }
    const mdPath = join(TMP, "rep.md");
    const jsonPath = join(TMP, "rep.json");
    const exit = executeReport({ repoRoot: TMP, out: mdPath });
    expect(exit).toBe(1);
    expect(existsSync(jsonPath)).toBe(true);
    const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(json.failingCount).toBeGreaterThanOrEqual(1);
    expect(json.incomplete).toBe(true);
  });
});
