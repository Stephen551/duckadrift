import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import { s5Decay } from "../src/tier1/checks/s5-decay.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { replayTransport } from "../src/tier1/transport.js";

// S5 — decay sweep, two-stage (ADR-0036): the recorded model extraction, then
// the deterministic dead-premise confirmation. The recording is the oracle for
// stage 1; the filesystem is the oracle for stage 2.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1 = join(__dirname, "fixtures", "tier1");
const S5_FIXTURE = join(TIER1, "s5-decay");
const S5_RECORDING = join(S5_FIXTURE, "recordings", "s5.api.recording.json");
const BASELINE = join(TIER1, "clean-baseline");
const BASELINE_RECORDING = join(BASELINE, "recordings", "s5.api.recording.json");

describe("S5 against the decay specimen", () => {
  it("surviving findings name both dead premises, each confirmed dead by the deterministic pass", async () => {
    const result = await runTier1Checks(loadAdrLog(S5_FIXTURE), [s5Decay], replayTransport(S5_RECORDING));
    expect(result.errors).toEqual([]);
    // Both dead premises survive confirmation (leftpad-classic absent from
    // package.json; src/pipeline/color.ts absent from disk).
    const quoted = result.findings.flatMap((f) => f.citations.map((c) => c.quote)).join("\n");
    expect(quoted).toContain("leftpad-classic");
    expect(quoted).toContain("src/pipeline/color.ts");
    // Every surviving finding is real decay — none was dropped as live.
    expect(result.livePremises).toEqual([]);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("S5 against the clean baseline (the negative control)", () => {
  it("zero surviving decay findings — the discriminator keeps the control clean, not a sterilized fixture", async () => {
    const result = await runTier1Checks(loadAdrLog(BASELINE), [s5Decay], replayTransport(BASELINE_RECORDING));
    expect(result.errors).toEqual([]);
    expect(result.findings).toEqual([]);
    // If the recorded model extraction surfaced any premise, the deterministic
    // layer is what dropped it — it appears in livePremises, never in findings.
    // (This recording extracted none, so both are empty; the assertion holds
    // for either legitimate outcome.)
    for (const p of result.livePremises) expect(p.check).toBe("S5");
  });
});
