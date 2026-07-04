import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Behavioral proof against a real crash trigger: a malformed pr-context file.
// loadPrContext JSON.parses it with no SetupError wrapping, so invalid JSON
// throws a non-setup error mid-scan — exactly the class S0 must turn into a
// loud failing report rather than a silent exit. A durable trigger, unlike the
// broken symlink this test used before S2 taught the walker to tolerate
// symlinks (that crash no longer happens; see walk-symlink.test.ts).
describe("S0: an unexpected crash writes a failing report, never a missing one", () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, "docs", "adr"), { recursive: true });
    writeFileSync(
      join(TMP, "docs", "adr", "0001-ok.md"),
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n"
    );
    writeFileSync(join(TMP, "pr-context.json"), "{ this is not valid json");
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("a crash mid-scan yields a failing report.json, not a missing one", () => {
    const mdPath = join(TMP, "rep.md");
    const jsonPath = join(TMP, "rep.json");
    const exit = executeReport({
      repoRoot: TMP,
      out: mdPath,
      prContextPath: join(TMP, "pr-context.json"),
    });
    expect(exit).toBe(1);
    expect(existsSync(jsonPath)).toBe(true);
    const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(json.failingCount).toBeGreaterThanOrEqual(1);
    expect(json.incomplete).toBe(true);
  });
});
