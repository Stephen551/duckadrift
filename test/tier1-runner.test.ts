import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import { buildJsonReport, renderMarkdownReport, withTier1Run } from "../src/report/write.js";
import type { Tier1Status } from "../src/report/write.js";
import { TIER1_CHECKS } from "../src/tier1/checks.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { replayTransport } from "../src/tier1/transport.js";
import { PROOF_CHECK } from "./fixtures/tier1/pipeline-proof/proof-check.js";

// The pipeline, end to end (ADR-0031): the test-only proof check driven
// through the REAL runner, prompt builder, replay transport (ADR-0028), and
// citation validator against a committed hand-seeded recording. CI makes zero
// API calls: the replay transport is the only transport here, and a prompt
// change fails these tests with the stale-recording error naming the check.

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF_DIR = join(__dirname, "fixtures", "tier1", "pipeline-proof");
const RECORDING = join(PROOF_DIR, "recording.json");

function proofContext() {
  return loadAdrLog(PROOF_DIR);
}

async function runProof() {
  return runTier1Checks(proofContext(), [PROOF_CHECK], replayTransport(RECORDING));
}

describe("the production registry (M3.3b)", () => {
  it("carries all five semantic checks", () => {
    expect(TIER1_CHECKS.map((c) => c.id).sort()).toEqual(["S1", "S2", "S3", "S4", "S5"]);
  });
});

describe("pipeline end-to-end against the committed recording", () => {
  it("accepts exactly the well-cited finding and discards the other two with correct reasons", async () => {
    const result = await runProof();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.citations).toEqual([
      {
        document: "0002-static-config.md",
        quote: "Configuration is read once at process start and never reloaded",
      },
    ]);
    expect(result.discarded.map((d) => d.reason).sort()).toEqual(["no-citations", "quote-not-found"]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("is byte-stable across two runs — results and rendered report", async () => {
    const first = await runProof();
    const second = await runProof();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const status = (run: typeof first): Tier1Status =>
      withTier1Run({ enabled: true, status: "eligible", signals: [] }, run);
    const md1 = renderMarkdownReport([], [], status(first));
    const md2 = renderMarkdownReport([], [], status(second));
    expect(md1).toBe(md2);
  });

  it("a check with no input is a loud skip, never a silent pass", async () => {
    const emptyCheck = { ...PROOF_CHECK, selectInput: () => ({ skip: "no-input" as const }) };
    const result = await runTier1Checks(proofContext(), [emptyCheck], replayTransport(RECORDING));
    expect(result.skipped).toEqual([{ check: "S1", reason: "no-input" }]);
    expect(result.errors).toEqual([]);
  });

  it("a prompt change surfaces as the ADR-0028 stale error naming the check — and the run continues", async () => {
    const mutated = { ...PROOF_CHECK, instructions: `${PROOF_CHECK.instructions} (edited)` };
    const result = await runTier1Checks(proofContext(), [mutated], replayTransport(RECORDING));
    expect(result.findings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain(
      "recording stale for S1: prompt changed since recording — re-record before trusting this test"
    );
  });
});

describe("findings never touch a Tier 0 surface", () => {
  it("failingCount stays 0 and Tier 0 sections are unchanged with a full Tier 1 run attached", async () => {
    const result = await runProof();
    const status = withTier1Run({ enabled: true, status: "eligible", signals: [] }, result);
    const json = buildJsonReport([], "docs/adr", [], status);
    expect(json.failingCount).toBe(0);
    expect(json.advisoryCount).toBe(0);
    expect(json.tier0Findings).toEqual([]);

    const md = renderMarkdownReport([], [], status);
    expect(md).toContain("Tier 0 findings: 0 (0 failing, 0 advisory)");
    expect(md).toContain("### Findings (UNCALIBRATED — annex only)");
    expect(md).toContain(
      "assessed by the checker — UNCALIBRATED (annex only; interrupts require a calibration entry, PDR §2.6)"
    );
    // Raw confidence decimals never appear in the markdown (PDR §3.1) — the
    // numbers live in report.json only.
    expect(md).not.toContain("0.55");
    expect(JSON.stringify(json)).toContain("0.55");
  });
});

describe("structural absence of an interrupt path", () => {
  // TRIPWIRE, with stated limits: grepping the built tier1 output for the
  // GitHub API surface proves the absence of these strings, not the absence
  // of capability in general — a determined change could interrupt some other
  // way. The real enforcement is structural (no interrupt module exists to
  // import; the runner returns findings and the report's annex is their only
  // destination), reviewed at PR time. This test exists so an accidental
  // import of an interrupt-shaped dependency goes red immediately.
  it("dist/tier1 contains no GitHub interrupt surface", () => {
    const distDir = join(__dirname, "..", "dist", "tier1");
    const files = readdirSync(distDir).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    const combined = files.map((f) => readFileSync(join(distDir, f), "utf-8")).join("\n");
    for (const marker of [
      "api.github.com",
      "octokit",
      "createComment",
      "createReview",
      "issues.create",
      "pulls.createReview",
      "GITHUB_TOKEN",
    ]) {
      expect(combined, `interrupt tripwire: found "${marker}" in dist/tier1`).not.toContain(marker);
    }
  });
});
