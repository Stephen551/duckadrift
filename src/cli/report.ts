import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadAdrLog } from "../adr/load.js";
import { runAllTierZeroChecks } from "../checks/index.js";
import { loadConfig } from "../config/load.js";
import { SetupError } from "../errors.js";
import { buildErrorReport, buildJsonReport, renderMarkdownReport, withTier1Run } from "../report/write.js";
import { consumeCalibration } from "../tier1/calibration/consume.js";
import { routeFindings } from "../tier1/calibration/route.js";
import { TIER1_CHECKS } from "../tier1/checks.js";
import { resolveTier1Status } from "../tier1/gate.js";
import { runTier1Checks } from "../tier1/runner.js";
import { backendCredentialsPresent, liveTransportFor } from "../tier1/transport.js";

export interface ReportOptions {
  repoRoot: string;
  prContextPath?: string;
  out?: string;
  adrDir?: string;
}

/**
 * Runs the report pipeline and writes duckadrift-report.{md,json}. Returns the
 * process exit code (0 = completed, 1 = the scan crashed). Kept out of the CLI
 * entrypoint module so tests can drive it without triggering `main()`.
 *
 * The catch is the silent-green fix (ADR-0013): before it, a crash partway
 * through the scan wrote no report at all, and the Action read the absence as
 * `failing-count=0` and passed green. Now an incomplete scan writes a LOUD
 * failing report — the watch may fail, it never stands down silently (the
 * Pact). A SetupError (no ADR directory yet) is not a scan failure and is
 * re-thrown for the caller's friendly exit-2 path.
 */
export async function executeReport(opts: ReportOptions): Promise<number> {
  const mdPath = opts.out ?? resolve(opts.repoRoot, "duckadrift-report.md");
  const jsonPath = mdPath.replace(/\.md$/i, "") + ".json";

  try {
    const ctx = loadAdrLog(opts.repoRoot, opts.prContextPath, opts.adrDir);
    const findings = runAllTierZeroChecks(ctx);

    // Second config load is quiet: loadAdrLog's internal load already emitted
    // any per-run notices (config/load.ts documents this contract).
    const tier1Config = loadConfig(opts.repoRoot, { quiet: true }).tier1;
    // Credential presence is asked per configured backend through the
    // transport module's one map (ADR-0044): this caller never learns which
    // env var a backend needs.
    let tier1 = resolveTier1Status(tier1Config, backendCredentialsPresent(tier1Config.backend), ctx);
    // The live semantic run (M3.3a — the wiring M3.2 deferred). Report-only:
    // `check` never runs Tier 1 and the verdict channel stays deterministic
    // (PDR §2.5). Transport construction happens AFTER the status gate, so a
    // disabled / no-credentials / no-signal run provably never builds one.
    if (tier1.enabled && tier1.status === "eligible" && TIER1_CHECKS.length > 0) {
      // The live semantic run. Schedule mode is the sweep (PDR 2.8): it pauses
      // visibly on quota exhaustion and the next run restarts from the
      // beginning (ADR-0047: no checkpoint is written or read, so the scanned
      // repo can never plant sweep state the tool trusts). PR-mode runs are
      // gated and small. One engine: neither mode reads sweep state.
      const run = await runTier1Checks(ctx, TIER1_CHECKS, liveTransportFor(tier1Config, opts.repoRoot));
      // Calibration consumption + routing (ADR-0042): the artifact is read
      // (repo-local overrides shipped), each severity's channel state derived
      // from its own measurements, and each finding routed. On the shipped
      // artifact every channel is closed and every finding stays annex-only.
      const consumption = consumeCalibration(opts.repoRoot, {
        backend: tier1Config.backend,
        model: tier1Config.model,
        effort: tier1Config.effort,
      });
      const adrsByFileName = new Map(ctx.adrs.map((a) => [a.fileName, a]));
      const dispositions = routeFindings(run.findings, adrsByFileName, consumption);
      tier1 = withTier1Run(tier1, run, consumption, dispositions);
    }
    const markdown = renderMarkdownReport(findings, ctx.unrecognizedFiles, tier1);
    const adrDirRelative = relative(opts.repoRoot, ctx.adrDir).split("\\").join("/");
    const json = buildJsonReport(findings, adrDirRelative, ctx.unrecognizedFiles, tier1);

    writeFileSync(mdPath, markdown, "utf-8");
    writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8");

    const failing = findings.filter((f) => !f.advisory).length;
    console.log(
      `duckadrift: wrote ${mdPath} and ${jsonPath} (${findings.length} Tier 0 finding(s), ${failing} failing).`
    );
    return 0;
  } catch (err) {
    if (err instanceof SetupError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const { markdown, json } = buildErrorReport(message);
    writeFileSync(mdPath, markdown, "utf-8");
    writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
    console.error(`duckadrift: scan did not complete — ${message}`);
    console.error(`duckadrift: wrote a failing report to ${mdPath} (incomplete scan fails loud).`);
    return 1;
  }
}
