import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import type { AdrLogContext } from "../src/adr/types.js";
import { buildJsonReport, renderMarkdownReport, withTier1Run } from "../src/report/write.js";
import { s4RecurringRevision } from "../src/tier1/checks/s4-recurring-revision.js";
import { s2CodeVsDecision } from "../src/tier1/checks/s2-code-vs-decision.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { replayTransport } from "../src/tier1/transport.js";

// Per-check measured usage (ADR-0035, PDR §2.8). A recorded run accumulates the
// recording's usage per check; a skipped check contributes no usage entry.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1 = join(__dirname, "fixtures", "tier1");

describe("per-check usage accumulation", () => {
  it("a recorded S4 run carries one usage entry with the recording's measured tokens", async () => {
    const result = await runTier1Checks(
      loadAdrLog(join(TIER1, "s4-recurring-revision")),
      [s4RecurringRevision],
      replayTransport(join(TIER1, "s4-recurring-revision", "recordings", "s4.recording.json"))
    );
    expect(result.usage).toHaveLength(1);
    const u = result.usage[0]!;
    expect(u.check).toBe("S4");
    // The recorded S4 usage: a cache read of 2457 with 3420 input tokens.
    expect(u.inputTokens).toBeGreaterThan(0);
    expect(u.cacheReadTokens + u.cacheCreationTokens).toBeGreaterThan(0);
  });

  it("a skipped check contributes no usage entry", async () => {
    // S2 with no PR context skips — no call, no usage.
    const base = loadAdrLog(join(TIER1, "s4-recurring-revision"));
    const noPr: AdrLogContext = { ...base, prContext: null };
    const result = await runTier1Checks(
      noPr,
      [s2CodeVsDecision],
      replayTransport(join(TIER1, "s4-recurring-revision", "recordings", "s4.recording.json"))
    );
    expect(result.skipped.map((s) => s.check)).toContain("S2");
    expect(result.usage).toEqual([]);
  });

  it("usage lands in report.json and a measured line in the markdown annex", async () => {
    const result = await runTier1Checks(
      loadAdrLog(join(TIER1, "s4-recurring-revision")),
      [s4RecurringRevision],
      replayTransport(join(TIER1, "s4-recurring-revision", "recordings", "s4.recording.json"))
    );
    const status = withTier1Run({ enabled: true, status: "eligible", signals: [] }, result);
    const json = buildJsonReport([], "docs/adr", [], status);
    expect(JSON.stringify(json)).toContain('"usage"');
    const md = renderMarkdownReport([], [], status);
    expect(md).toContain("Token usage (measured):");
    expect(md).toMatch(/- S4: input \d+, output \d+, cache read \d+, cache write \d+/);
  });
});
