import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import { s1Contradiction } from "../src/tier1/checks/s1-contradiction.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { replayTransport } from "../src/tier1/transport.js";

// S1 — inter-ADR contradiction, asserted against the committed live recording
// (ADR-0028). The fixture's seeded pair is grep-resistant by design (M3.0):
// 0001 (embedded file, nothing listening) and 0003 (managed PostgreSQL over
// TLS) share no key nouns beyond "persistence"; 0002 (structured logging) is
// the control and must never be implicated. Counts beyond the gate assertions
// are the recording's, not the contract's.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1 = join(__dirname, "fixtures", "tier1");
const S1_FIXTURE = join(TIER1, "s1-contradiction");
const S1_RECORDING = join(S1_FIXTURE, "recordings", "s1.api.recording.json");
const BASELINE = join(TIER1, "clean-baseline");
const BASELINE_RECORDING = join(BASELINE, "recordings", "s1.api.recording.json");

const PAIR_A = "0001-embedded-file-local-persistence.md";
const PAIR_B = "0003-postgresql-system-of-record.md";
const CONTROL = "0002-structured-log-lines.md";

describe("S1 against the seeded contradiction", () => {
  it("accepts at least one finding citing both members of the 0001/0003 pair", async () => {
    const result = await runTier1Checks(
      loadAdrLog(S1_FIXTURE),
      [s1Contradiction],
      replayTransport(S1_RECORDING)
    );
    expect(result.errors).toEqual([]);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);

    const pairFinding = result.findings.find((f) => {
      const docs = new Set(f.citations.map((c) => c.document));
      return docs.has(PAIR_A) && docs.has(PAIR_B);
    });
    expect(pairFinding, "no finding cites both 0001 and 0003").toBeDefined();
  });

  it("never implicates the logging control", async () => {
    const result = await runTier1Checks(
      loadAdrLog(S1_FIXTURE),
      [s1Contradiction],
      replayTransport(S1_RECORDING)
    );
    for (const finding of result.findings) {
      const docs = finding.citations.map((c) => c.document);
      expect(docs, `finding cites the control: ${finding.claim.slice(0, 80)}`).not.toContain(
        CONTROL
      );
    }
  });
});

describe("S1 against the clean baseline (the negative control)", () => {
  it("accepts zero findings — the live model returned the empty report", async () => {
    const result = await runTier1Checks(
      loadAdrLog(BASELINE),
      [s1Contradiction],
      replayTransport(BASELINE_RECORDING)
    );
    expect(result.findings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
