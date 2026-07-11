import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import { captureOne, usageSiblingPath } from "../src/tier1/capture.js";
import type { CheckDefinition } from "../src/tier1/checks.js";
import type { Tier1Transport } from "../src/tier1/transport.js";

// The durable capture path (ADR-0037), proven API-free: a stub transport
// stands in for the wire. The load-bearing property is the checkpoint — a
// second capture of an already-recorded request makes ZERO transport calls,
// which is the $0-resume the M4 balance depends on.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-capture");
const FIXTURE = join(__dirname, "fixtures", "tier1", "s4-recurring-revision");

// A whole-log check that always selects the fixture's documents.
const CHECK: CheckDefinition = {
  id: "S4",
  title: "capture test",
  instructions: "capture test instructions",
  selectInput: (ctx) => ({
    documents: ctx.adrs.map((a) => ({ label: a.fileName, path: a.fileName, content: a.raw })),
  }),
  minDistinctCitedDocuments: 1,
};

const CONFIG = { model: "claude-sonnet-5", effort: "high" };

/** A transport that returns a canned body and counts its calls — a live call would throw if it were reached when it must not be. */
function countingTransport(body: unknown): { transport: Tier1Transport; calls: () => number } {
  let calls = 0;
  return {
    transport: { async send() { calls += 1; return body; } },
    calls: () => calls,
  };
}

const RESPONSE = {
  id: "msg_capture_test",
  content: [{ type: "tool_use", name: "report_findings", input: { findings: [] } }],
  usage: { input_tokens: 3400, output_tokens: 40, cache_creation_input_tokens: 2400, cache_read_input_tokens: 0 },
};

describe("captureOne — checkpoint and durability (ADR-0037)", () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it("captures a fresh recording and its usage sibling, written immediately", async () => {
    mkdirSync(TMP, { recursive: true });
    const rec = join(TMP, "s4.recording.json");
    const { transport, calls } = countingTransport(RESPONSE);

    const result = await captureOne({ ctx: loadAdrLog(FIXTURE), check: CHECK, config: CONFIG, transport, recordingPath: rec });

    expect(result.status).toBe("captured");
    expect(calls()).toBe(1);
    expect(existsSync(rec)).toBe(true);
    expect(existsSync(usageSiblingPath(rec))).toBe(true);
    const written = JSON.parse(readFileSync(rec, "utf-8"));
    expect(written.key.checkId).toBe("S4");
    expect(written.key.promptHash).toHaveLength(64);
    // The usage sibling carries the measured block verbatim.
    expect(JSON.parse(readFileSync(usageSiblingPath(rec), "utf-8"))).toEqual(RESPONSE.usage);
  });

  it("a second capture of the same request makes ZERO calls — the $0-resume", async () => {
    mkdirSync(TMP, { recursive: true });
    const rec = join(TMP, "s4.recording.json");

    const first = countingTransport(RESPONSE);
    await captureOne({ ctx: loadAdrLog(FIXTURE), check: CHECK, config: CONFIG, transport: first.transport, recordingPath: rec });
    expect(first.calls()).toBe(1);

    // Resume: a transport that THROWS if touched proves the checkpoint skips it.
    const forbidden: Tier1Transport = {
      async send() {
        throw new Error("transport must not be called for an already-captured recording");
      },
    };
    const result = await captureOne({ ctx: loadAdrLog(FIXTURE), check: CHECK, config: CONFIG, transport: forbidden, recordingPath: rec });
    expect(result.status).toBe("skipped-cached");
  });

  it("a recording whose hash no longer matches is re-captured (not silently trusted)", async () => {
    mkdirSync(TMP, { recursive: true });
    const rec = join(TMP, "s4.recording.json");
    await captureOne({ ctx: loadAdrLog(FIXTURE), check: CHECK, config: CONFIG, transport: countingTransport(RESPONSE).transport, recordingPath: rec });

    // A changed instruction changes the hash — the old recording is stale.
    const changed = { ...CHECK, instructions: `${CHECK.instructions} (edited)` };
    const { transport, calls } = countingTransport(RESPONSE);
    const result = await captureOne({ ctx: loadAdrLog(FIXTURE), check: changed, config: CONFIG, transport, recordingPath: rec });
    expect(result.status).toBe("captured");
    expect(calls()).toBe(1); // it re-paid because the request genuinely changed
  });

  it("a check with no input is a skip, not a call", async () => {
    mkdirSync(TMP, { recursive: true });
    const rec = join(TMP, "s4.recording.json");
    const noInput: CheckDefinition = { ...CHECK, selectInput: () => ({ skip: "no-input" }) };
    const { transport, calls } = countingTransport(RESPONSE);
    const result = await captureOne({ ctx: loadAdrLog(FIXTURE), check: noInput, config: CONFIG, transport, recordingPath: rec });
    expect(result.status).toBe("skipped-no-input");
    expect(calls()).toBe(0);
    expect(existsSync(rec)).toBe(false);
  });
});
