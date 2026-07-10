import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// The recorded-response harness (ADR-0028). The semantic tier calls a model; the
// development loop must not (PDR §2.10). Every Tier 1 CI assertion replays a
// committed recording keyed by {backend, model, effort, checkId, promptHash} —
// the same tuple that gates calibration thresholds (PDR §2.6), so the test loop
// and the calibration doctrine cannot drift apart. Replay is refusal-first: a
// stale recording silently replayed is a false green, and the harness throws
// instead.

export interface RecordingKey {
  backend: "api";
  model: string;
  effort: string;
  checkId: string; // "S1".."S5"
  promptHash: string; // sha256 hex of the canonical request
}

export interface Recording {
  schemaVersion: 1;
  key: RecordingKey;
  recordedAt: string; // ISO
  requestDigest: string; // sha256 hex of the exact serialized request body
  response: unknown; // the verbatim API response body
}

// Canonical JSON: sorted keys, no whitespace, JSON.stringify semantics for
// leaves (NaN/Infinity serialize as null; undefined, functions, and symbols are
// omitted from objects and null'd in arrays — exactly what JSON.stringify does,
// so the canon of a request equals the canon of its JSON round-trip). The whole
// request object is serialized; nothing is excluded (ADR-0028: excluding a
// field is a bet that it never matters, and a lost bet is a silent false green).
function canonicalize(value: unknown): string | undefined {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item) ?? "null").join(",")}]`;
  }
  if (typeof value === "object") {
    const entries: string[] = [];
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const serialized = canonicalize((value as Record<string, unknown>)[key]);
      if (serialized !== undefined) entries.push(`${JSON.stringify(key)}:${serialized}`);
    }
    return `{${entries.join(",")}}`;
  }
  return undefined; // undefined / function / symbol — omitted, as in JSON.stringify
}

/** sha256 hex of the canonical (sorted-keys, no-whitespace) serialization of the whole request object. */
export function canonicalRequestHash(request: object): string {
  const canonical = canonicalize(request);
  if (canonical === undefined) {
    throw new Error("canonicalRequestHash: request is not a JSON-serializable object");
  }
  return createHash("sha256").update(canonical, "utf-8").digest("hex");
}

function fail(path: string, defect: string): never {
  throw new Error(`recording at ${path} is not readable: ${defect}`);
}

function assertString(value: unknown, field: string, path: string): string {
  if (typeof value !== "string" || value === "") {
    fail(path, `"${field}" must be a non-empty string`);
  }
  return value;
}

/** Loads and validates a recording file. Throws on schema mismatch — an unreadable recording must never pass as a replayable one. */
export function loadRecording(path: string): Recording {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    fail(path, err instanceof Error ? err.message : String(err));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(path, "the recording must be a JSON object");
  }
  const candidate = parsed as Record<string, unknown>;

  if (candidate.schemaVersion !== 1) {
    fail(
      path,
      `schemaVersion ${JSON.stringify(candidate.schemaVersion)} is not the schemaVersion 1 this build reads — re-record with the current harness before trusting this test`
    );
  }
  if (typeof candidate.key !== "object" || candidate.key === null || Array.isArray(candidate.key)) {
    fail(path, `"key" must be an object`);
  }
  const key = candidate.key as Record<string, unknown>;
  if (key.backend !== "api") {
    fail(path, `key.backend must be "api" (the only backend with recordings in M3)`);
  }
  const recording: Recording = {
    schemaVersion: 1,
    key: {
      backend: "api",
      model: assertString(key.model, "key.model", path),
      effort: assertString(key.effort, "key.effort", path),
      checkId: assertString(key.checkId, "key.checkId", path),
      promptHash: assertString(key.promptHash, "key.promptHash", path),
    },
    recordedAt: assertString(candidate.recordedAt, "recordedAt", path),
    requestDigest: assertString(candidate.requestDigest, "requestDigest", path),
    response: candidate.response,
  };
  if (!("response" in candidate)) {
    fail(path, `"response" is missing — a recording with nothing to replay is not a recording`);
  }
  return recording;
}

/**
 * The load-bearing rule (ADR-0028): replay only when the request the caller
 * would send right now hashes to the recording's promptHash. A mismatch means
 * the prompt evolved after the recording was made — replaying anyway would test
 * a conversation the code no longer has, the false green this module exists to
 * prevent. Refusal-first: throw loudly with the re-record instruction.
 */
export function replayOrFail(request: object, recordingPath: string): unknown {
  const recording = loadRecording(recordingPath);
  const requestHash = canonicalRequestHash(request);
  if (requestHash !== recording.key.promptHash) {
    throw new Error(
      `recording stale for ${recording.key.checkId}: prompt changed since recording — re-record before trusting this test`
    );
  }
  return recording.response;
}
