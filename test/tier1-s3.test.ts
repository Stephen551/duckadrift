import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import type { AdrLogContext } from "../src/adr/types.js";
import { s3UnrecordedDecision } from "../src/tier1/checks/s3-unrecorded-decision.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { replayTransport } from "../src/tier1/transport.js";
import { isSkip } from "../src/tier1/select.js";

// S3 — unrecorded decision, against the committed live recording (ADR-0028,
// ADR-0035). The seeded diff carries two architectural signals and touches no
// decision record.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1 = join(__dirname, "fixtures", "tier1");
const S3_FIXTURE = join(TIER1, "s3-unrecorded-decision");
const S3_RECORDING = join(S3_FIXTURE, "recordings", "s3.recording.json");

function ctxWithPr(): AdrLogContext {
  return loadAdrLog(S3_FIXTURE, join(S3_FIXTURE, "pr-context.json"));
}

describe("S3 against the seeded unrecorded signals", () => {
  it("accepts at least one finding citing a signal file", async () => {
    const result = await runTier1Checks(ctxWithPr(), [s3UnrecordedDecision], replayTransport(S3_RECORDING));
    expect(result.errors).toEqual([]);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const cited = new Set(result.findings.flatMap((f) => f.citations.map((c) => c.document)));
    // At least one of the two signal files is cited.
    expect([...cited].some((d) => d === "package.json" || d === "src/storage/schema.ts")).toBe(true);
  });
});

describe("S3 selection: PR-mode, and the control (ADR touched → stand down)", () => {
  it("no PR context → no-input skip", () => {
    expect(s3UnrecordedDecision.selectInput(loadAdrLog(S3_FIXTURE))).toEqual({ skip: "no-input" });
  });

  it("the same signal diff WITH an ADR touch → no-input skip (the manifest control)", () => {
    // The fixture manifest's control contract: signals + an ADR touch = no S3.
    const base = loadAdrLog(S3_FIXTURE);
    const withAdrTouch: AdrLogContext = {
      ...base,
      prContext: {
        changedFiles: ["package.json", "src/storage/schema.ts", "docs/adr/0002-order-storage.md"],
      },
    };
    const sel = s3UnrecordedDecision.selectInput(withAdrTouch);
    expect(isSkip(sel) && sel.skip).toBe("no-input");
  });

  it("a diff with no architectural signal → no-input skip", () => {
    const base = loadAdrLog(S3_FIXTURE);
    const noSignal: AdrLogContext = { ...base, prContext: { changedFiles: ["README.md"] } };
    expect(s3UnrecordedDecision.selectInput(noSignal)).toEqual({ skip: "no-input" });
  });
});
