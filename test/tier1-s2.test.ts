import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import type { AdrLogContext } from "../src/adr/types.js";
import { s2CodeVsDecision } from "../src/tier1/checks/s2-code-vs-decision.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { replayTransport } from "../src/tier1/transport.js";
import { isSkip } from "../src/tier1/select.js";

// S2 — code-vs-decision drift, against the committed live recording (ADR-0028,
// ADR-0035). Assertions pin the contract (coverage, the cited documents), not
// the recording's exact wording.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1 = join(__dirname, "fixtures", "tier1");
const S2_FIXTURE = join(TIER1, "s2-code-vs-decision");
const S2_RECORDING = join(S2_FIXTURE, "recordings", "s2.api.recording.json");

function ctxWithPr(): AdrLogContext {
  return loadAdrLog(S2_FIXTURE, join(S2_FIXTURE, "pr-context.json"));
}

describe("S2 against the seeded governed violation", () => {
  it("accepts a finding citing both the governing ADR and the violating file", async () => {
    const result = await runTier1Checks(ctxWithPr(), [s2CodeVsDecision], replayTransport(S2_RECORDING));
    expect(result.errors).toEqual([]);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const finding = result.findings.find((f) => {
      const docs = new Set(f.citations.map((c) => c.document));
      return docs.has("0001-outbound-http-via-retry-wrapper.md") && docs.has("src/net/client.ts");
    });
    expect(finding, "no finding cites both the ADR and client.ts").toBeDefined();
    // Structural coverage: a drift finding cites two distinct documents (ADR-0033).
    for (const f of result.findings) {
      expect(new Set(f.citations.map((c) => c.document)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("S2 selection: PR-mode only", () => {
  it("no PR context → no-input skip (the diff is the input)", () => {
    expect(s2CodeVsDecision.selectInput(loadAdrLog(S2_FIXTURE))).toEqual({ skip: "no-input" });
  });

  it("clean-baseline (no governed ADR) → no-input skip, whatever the diff", () => {
    const base = loadAdrLog(join(TIER1, "clean-baseline"));
    const withPr: AdrLogContext = { ...base, prContext: { changedFiles: ["src/anything.ts"] } };
    const sel = s2CodeVsDecision.selectInput(withPr);
    expect(isSkip(sel) && sel.skip).toBe("no-input");
  });
});
