import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAdrLog } from "../adr/load.js";
import { loadConfig } from "../config/load.js";
import { SetupError } from "../errors.js";
import { TIER1_CHECKS } from "../tier1/checks.js";
import { captureOne } from "../tier1/capture.js";
import { liveTransportFor } from "../tier1/transport.js";

// The capture CLI path (ADR-0037). Deliberately separate from check/report —
// it makes live paid calls and must never sit on a verdict path (PDR §2.5).
// It reuses the check's own selectInput, the shared prompt builder, and the
// ADR-0028 recording contract; nothing here forks the pipeline.

/**
 * `duckadrift capture <root> --check <ID> --out <recording.json> [--pr-context <f>] [--adr-dir <p>]`
 * Runs one check against one ADR log, checkpoint-aware, and writes the
 * recording + its usage sibling the instant the call returns. Returns the
 * process exit code: 0 = captured or skipped-cached, 1 = a transport error
 * (loud), 2 = a setup problem.
 */
export async function executeCapture(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      check: { type: "string" },
      out: { type: "string" },
      "pr-context": { type: "string" },
      "adr-dir": { type: "string" },
    },
    allowPositionals: true,
  });

  const checkId = values.check;
  const out = values.out;
  if (checkId === undefined || out === undefined) {
    console.error("duckadrift capture: --check <ID> and --out <recording.json> are required.");
    return 2;
  }
  const check = TIER1_CHECKS.find((c) => c.id === checkId);
  if (check === undefined) {
    console.error(
      `duckadrift capture: unknown check ${JSON.stringify(checkId)} — known: ${TIER1_CHECKS.map((c) => c.id).join(", ")}.`
    );
    return 2;
  }

  const repoRoot = resolve(positionals[0] ?? ".");
  const recordingPath = resolve(out);

  try {
    const ctx = loadAdrLog(
      repoRoot,
      values["pr-context"],
      values["adr-dir"]
    );
    const tier1 = loadConfig(repoRoot, { quiet: true }).tier1;

    mkdirSync(dirname(recordingPath), { recursive: true });
    // The transport and the recording key both come from the configured
    // backend through the transport module's one factory (ADR-0044).
    const result = await captureOne({
      ctx,
      check,
      config: { model: tier1.model, effort: tier1.effort },
      backend: tier1.backend,
      transport: liveTransportFor(tier1, repoRoot),
      recordingPath,
    });

    switch (result.status) {
      case "captured":
        console.log(`duckadrift capture: ${check.id} captured → ${recordingPath}`);
        return 0;
      case "skipped-cached":
        console.log(`duckadrift capture: ${check.id} already captured (hash match) — no call, no spend.`);
        return 0;
      case "skipped-no-input":
        console.log(`duckadrift capture: ${check.id} has no input for this mode — nothing to capture.`);
        return 0;
      case "skipped-input-exceeds-cap":
        console.error(
          `duckadrift capture: ${check.id} selected ${result.bytes} bytes, over the single-call cap (ADR-0032) — not captured.`
        );
        return 1;
    }
  } catch (err) {
    if (err instanceof SetupError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Loud, never silent (PDR §2.8 quota-exhaustion doctrine, applied to
    // capture): every already-written recording is intact; re-running resumes
    // from the next uncaptured check with zero re-payment.
    console.error(`duckadrift capture: ${check.id} FAILED before capture — ${message}`);
    console.error("duckadrift capture: nothing already captured was lost; re-run to resume from here.");
    return 1;
  }
}
