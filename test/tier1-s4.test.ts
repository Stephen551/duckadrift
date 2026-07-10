import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import type { AdrLogContext } from "../src/adr/types.js";
import { renderMarkdownReport, withTier1Run } from "../src/report/write.js";
import { s4RecurringRevision } from "../src/tier1/checks/s4-recurring-revision.js";
import { TIER1_INPUT_CAP_BYTES, isSkip } from "../src/tier1/select.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { replayTransport } from "../src/tier1/transport.js";

// S4 — recurring revision, asserted against the committed live recording
// (ADR-0028: the recording is an oracle, recorded once, never re-rolled to
// please an assertion). The G3 gate criterion lives here in test form.
// Deliberately NOT over-asserted: exact finding counts and claim wording are
// the recording's, not the contract's — brittle over-assertion would turn
// every legitimate future re-record into a test rewrite.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1 = join(__dirname, "fixtures", "tier1");
const S4_FIXTURE = join(TIER1, "s4-recurring-revision");
const S4_RECORDING = join(S4_FIXTURE, "recordings", "s4.recording.json");
const BASELINE = join(TIER1, "clean-baseline");
const BASELINE_RECORDING = join(BASELINE, "recordings", "s4.recording.json");

describe("S4 against the 0040-0043 specimen (the G3 criterion)", () => {
  it("accepts at least one finding naming the bridge-vs-weld primitive across >=3 documents", async () => {
    const result = await runTier1Checks(
      loadAdrLog(S4_FIXTURE),
      [s4RecurringRevision],
      replayTransport(S4_RECORDING)
    );
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);

    const gateFinding = result.findings.find((f) => {
      const docs = new Set(f.citations.map((c) => c.document));
      const spansThree =
        [...docs].filter((d) => /^004[0-3]-/.test(d)).length >= 3;
      return spansThree && /bridge/i.test(f.claim) && /weld/i.test(f.claim);
    });
    expect(
      gateFinding,
      "no finding names the bridge/weld primitive with citations spanning >=3 of 0040-0043"
    ).toBeDefined();
  });
});

describe("S4 against the clean baseline (the negative control)", () => {
  it("accepts zero findings — the live model returned the empty report", async () => {
    const result = await runTier1Checks(
      loadAdrLog(BASELINE),
      [s4RecurringRevision],
      replayTransport(BASELINE_RECORDING)
    );
    expect(result.findings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("S4 selection: PR mode and the ADR-0032 cap", () => {
  function baselineCtx(): AdrLogContext {
    return loadAdrLog(BASELINE);
  }

  it("PR mode: selects only when the diff touches the ADR directory", () => {
    const touching: AdrLogContext = {
      ...baselineCtx(),
      prContext: { changedFiles: ["docs/adr/0005-new-decision.md", "src/x.ts"] },
    };
    expect(isSkip(s4RecurringRevision.selectInput(touching))).toBe(false);

    const notTouching: AdrLogContext = {
      ...baselineCtx(),
      prContext: { changedFiles: ["src/x.ts", "README.md"] },
    };
    expect(s4RecurringRevision.selectInput(notTouching)).toEqual({ skip: "no-input" });
  });

  it("full-log mode (no PR context): always selects", () => {
    const selection = s4RecurringRevision.selectInput(baselineCtx());
    expect(isSkip(selection)).toBe(false);
  });

  it("over the cap: skips aloud with the measured size — never trims (ADR-0032)", async () => {
    const ctx = baselineCtx();
    // Synthetic oversize: inflate one ADR's raw past the cap in memory.
    const inflated: AdrLogContext = {
      ...ctx,
      adrs: ctx.adrs.map((adr, i) =>
        i === 0 ? { ...adr, raw: adr.raw + "x".repeat(TIER1_INPUT_CAP_BYTES) } : adr
      ),
    };
    const selection = s4RecurringRevision.selectInput(inflated);
    expect(isSkip(selection)).toBe(true);
    if (isSkip(selection) && selection.skip === "input-exceeds-cap") {
      expect(selection.bytes).toBeGreaterThan(TIER1_INPUT_CAP_BYTES);
    } else {
      expect.fail("expected input-exceeds-cap");
    }

    // Through the runner: the skip entry carries bytes + cap, and the report
    // renders both — a Tier 1 gap is stated, never silently absorbed.
    const result = await runTier1Checks(inflated, [s4RecurringRevision], {
      send: async () => {
        throw new Error("transport must not be reached on a skipped check");
      },
    });
    expect(result.skipped).toHaveLength(1);
    const skip = result.skipped[0]!;
    expect(skip.reason).toBe("input-exceeds-cap");
    if (skip.reason === "input-exceeds-cap") {
      expect(skip.cap).toBe(TIER1_INPUT_CAP_BYTES);
      expect(skip.bytes).toBeGreaterThan(TIER1_INPUT_CAP_BYTES);
    }

    const md = renderMarkdownReport(
      [],
      [],
      withTier1Run({ enabled: true, status: "eligible", signals: [] }, result)
    );
    expect(md).toContain("input-exceeds-cap");
    expect(md).toContain(`the single-call cap is ${TIER1_INPUT_CAP_BYTES} bytes (ADR-0032)`);
    if (skip.reason === "input-exceeds-cap") {
      expect(md).toContain(`measure ${skip.bytes} bytes`);
    }
  });
});
