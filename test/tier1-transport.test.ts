import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalRequestHash, loadRecording } from "../src/tier1/recording.js";
import { replayTransport } from "../src/tier1/transport.js";

// The transport contract's recording proof (ADR-0044): the claude-code
// backend's first recording, hand-seeded from the PR B spike's canonical
// capture, replays deterministically with zero credentials. The live
// claude-code transport is M5.1; this proves the recording layer and the
// seam's usage extraction are backend-ready ahead of it.

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF_DIR = join(__dirname, "fixtures", "tier1", "transport-proof");
const REQUEST_PATH = join(PROOF_DIR, "request.json");
const RECORDING_PATH = join(PROOF_DIR, "claude-code.recording.json");
const BAD_BACKEND_PATH = join(PROOF_DIR, "bad-backend.json");

function loadStubRequest(): object {
  return JSON.parse(readFileSync(REQUEST_PATH, "utf-8")) as object;
}

describe("transport contract: the claude-code recording replays with zero credentials (ADR-0044)", () => {
  it("loadRecording accepts the claude-code backend and round-trips its key", () => {
    const recording = loadRecording(RECORDING_PATH);
    expect(recording.key.backend).toBe("claude-code");
    expect(recording.key.model).toBe("claude-sonnet-5");
    expect(recording.key.effort).toBe("high");
    expect(recording.key.promptHash).toBe(canonicalRequestHash(loadStubRequest()));
  });

  it("replay returns the stored seam output verbatim and extracts its usage block", async () => {
    const result = await replayTransport(RECORDING_PATH).send(loadStubRequest());
    const recording = loadRecording(RECORDING_PATH);
    // The recording stores what the seam RETURNS (PR D: the extracted,
    // api-canonical shape), so replay and live stay one pipeline and the
    // runner sees identical shapes from both.
    expect(result.response).toEqual(recording.response);
    const stored = recording.response as { content: Array<Record<string, unknown>>; usage: Record<string, unknown> };
    expect(stored.content[0]!.type).toBe("tool_use");
    expect(stored.content[0]!.name).toBe("report_findings");
    expect(result.usage).toEqual(stored.usage);
    const usage = result.usage as Record<string, unknown>;
    expect(usage.input_tokens).toBe(2);
    expect(usage.output_tokens).toBe(65);
  });

  it("a stale request still refuses, backend notwithstanding", async () => {
    const mutated = { ...loadStubRequest(), max_tokens: 2048 };
    await expect(replayTransport(RECORDING_PATH).send(mutated)).rejects.toThrowError(
      /recording stale for S1/
    );
  });

  it("a decreed third backend is refused with the contract named", () => {
    expect(() => loadRecording(BAD_BACKEND_PATH)).toThrowError(/"api" or "claude-code"/);
  });
});
