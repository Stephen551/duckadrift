import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalRequestHash, loadRecording, replayOrFail } from "../src/tier1/recording.js";

// The recorded-response harness proof (ADR-0028). No check exists yet, so the
// recording under harness-proof/ is hand-seeded: this suite proves the replay
// loop itself — byte-stable replay, refusal-first staleness, schema refusal —
// before any prompt is written. Corpus and loop before code, at Tier 1 as at
// Tier 0.

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = join(__dirname, "fixtures", "tier1", "harness-proof");
const REQUEST_PATH = join(HARNESS_DIR, "request.json");
const RECORDING_PATH = join(HARNESS_DIR, "recording.json");
const BAD_SCHEMA_PATH = join(HARNESS_DIR, "bad-schema-version.json");

interface StubRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: string; content: string }[];
  tools: unknown[];
}

// A fresh parse per call — each test works on its own object, so a mutation in
// one test can never leak into another through a shared reference.
function loadStubRequest(): StubRequest {
  return JSON.parse(readFileSync(REQUEST_PATH, "utf-8")) as StubRequest;
}

describe("Tier 1 recorded-response harness: replay", () => {
  it("returns the recorded response byte-stably across two calls", () => {
    const first = replayOrFail(loadStubRequest(), RECORDING_PATH);
    const second = replayOrFail(loadStubRequest(), RECORDING_PATH);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    // And what it returns IS the committed recording's response, verbatim.
    const onDisk = JSON.parse(readFileSync(RECORDING_PATH, "utf-8")) as { response: unknown };
    expect(JSON.stringify(first)).toBe(JSON.stringify(onDisk.response));
  });

  it("throws the stale error when one byte of the request changes", () => {
    const mutated = loadStubRequest();
    mutated.system = `${mutated.system.slice(0, -1)}?`; // one byte differs
    expect(() => replayOrFail(mutated, RECORDING_PATH)).toThrowError(
      "recording stale for S1: prompt changed since recording — re-record before trusting this test"
    );
  });

  it("throws the stale error when a nested message byte changes", () => {
    const mutated = loadStubRequest();
    mutated.messages[0]!.content = `${mutated.messages[0]!.content} `;
    expect(() => replayOrFail(mutated, RECORDING_PATH)).toThrowError(/recording stale for S1/);
  });
});

describe("Tier 1 recorded-response harness: loading", () => {
  it("rejects an unknown schemaVersion", () => {
    expect(() => loadRecording(BAD_SCHEMA_PATH)).toThrowError(/schemaVersion/);
  });

  it("loads the committed recording and its key matches the stub request's canonical hash", () => {
    const recording = loadRecording(RECORDING_PATH);
    expect(recording.key.checkId).toBe("S1");
    expect(recording.key.promptHash).toBe(canonicalRequestHash(loadStubRequest()));
  });
});

describe("Tier 1 recorded-response harness: canonicalization", () => {
  it("hashes independently of object key order", () => {
    const request = loadStubRequest();
    // Rebuild the same request with keys inserted in reverse order.
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(request).reverse()) {
      reordered[key] = (request as unknown as Record<string, unknown>)[key];
    }
    expect(canonicalRequestHash(reordered)).toBe(canonicalRequestHash(request));
  });

  it("hashes differently when any field's value changes", () => {
    const request = loadStubRequest();
    const changed = { ...request, max_tokens: request.max_tokens + 1 };
    expect(canonicalRequestHash(changed)).not.toBe(canonicalRequestHash(request));
  });
});
