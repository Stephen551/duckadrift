import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AdrLogContext } from "../adr/types.js";
import type { CheckDefinition } from "./checks.js";
import { buildRequest } from "./prompt.js";
import type { Tier1PromptConfig } from "./prompt.js";
import { canonicalRequestHash } from "./recording.js";
import type { Recording } from "./recording.js";
import { isSkip } from "./select.js";
import type { Tier1Transport } from "./transport.js";

// The durable, checkpointed capture path (ADR-0037). Recordings were produced
// ad hoc through M3.3; M4 calibration will make hundreds of paid calls against
// a finite balance, so it needs a capture that never re-pays for work already
// on disk. Every recording is written the instant its call returns, before the
// next call; a completed recording whose promptHash matches the request is a
// checkpoint the tool skips without spending. This is NOT the calibration
// build — it is the capture primitive calibration leans on, landing early.

export type CaptureStatus =
  | "captured"
  | "skipped-cached"
  | "skipped-no-input"
  | "skipped-input-exceeds-cap";

export interface CaptureResult {
  status: CaptureStatus;
  checkId: string;
  recordingPath: string;
  /** The response's usage block, present only on a fresh capture (measured, never estimated — PDR §2.8). */
  usage?: unknown;
  /** Selected input size in bytes, present on an input-exceeds-cap skip. */
  bytes?: number;
}

/** The `.usage.json` sibling path for a recording — the measured token block lives beside the response it was billed for. */
export function usageSiblingPath(recordingPath: string): string {
  return /\.recording\.json$/i.test(recordingPath)
    ? recordingPath.replace(/\.recording\.json$/i, ".usage.json")
    : recordingPath.replace(/\.json$/i, ".usage.json");
}

/**
 * Captures ONE check against ONE ADR-log context to ONE recording path,
 * checkpoint-aware. Returns without a call when the recording already exists
 * with a matching hash (already paid for) or when the check has no input.
 * A transport error propagates — the caller reports it loudly and exits
 * non-zero, leaving every already-written recording intact (PDR §2.8
 * quota-exhaustion doctrine, applied to capture).
 */
export async function captureOne(opts: {
  ctx: AdrLogContext;
  check: CheckDefinition;
  config: Tier1PromptConfig;
  transport: Tier1Transport;
  recordingPath: string;
}): Promise<CaptureResult> {
  const { ctx, check, config, transport, recordingPath } = opts;

  const selection = check.selectInput(ctx);
  if (isSkip(selection)) {
    return selection.skip === "input-exceeds-cap"
      ? { status: "skipped-input-exceeds-cap", checkId: check.id, recordingPath, bytes: selection.bytes }
      : { status: "skipped-no-input", checkId: check.id, recordingPath };
  }

  const request = buildRequest(check, selection, config);
  const promptHash = canonicalRequestHash(request);

  // Checkpoint: an existing recording whose hash matches this exact request is
  // already captured and paid for — skip, no call, no spend.
  if (existsSync(recordingPath)) {
    try {
      const existing = JSON.parse(readFileSync(recordingPath, "utf-8")) as { key?: { promptHash?: unknown } };
      if (existing.key?.promptHash === promptHash) {
        return { status: "skipped-cached", checkId: check.id, recordingPath };
      }
    } catch {
      // Unreadable — fall through and overwrite with a fresh capture.
    }
  }

  const response = await transport.send(request);

  const recording: Recording = {
    schemaVersion: 1,
    key: { backend: "api", model: config.model, effort: config.effort, checkId: check.id, promptHash },
    // recordedAt is informational, not hashed — a live tool stamps wall-clock.
    recordedAt: new Date().toISOString(),
    requestDigest: promptHash,
    response,
  };

  // Write the recording FIRST, then the usage sibling — the recording is the
  // paid artifact; if the process dies between the two writes, the recording
  // (the expensive thing) is safe and the usage can be re-read from it.
  writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");
  const usage =
    typeof response === "object" && response !== null
      ? (response as Record<string, unknown>).usage ?? null
      : null;
  writeFileSync(usageSiblingPath(recordingPath), `${JSON.stringify(usage, null, 2)}\n`, "utf-8");

  return { status: "captured", checkId: check.id, recordingPath, usage };
}
