import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadAdrLog } from "../adr/load.js";
import { runAllTierZeroChecks } from "../checks/index.js";
import { loadConfig } from "../config/load.js";
import { SetupError } from "../errors.js";
import { buildErrorReport, buildJsonReport, renderMarkdownReport } from "../report/write.js";
import { tier1CredentialsPresent } from "../tier1/credentials.js";
import { resolveTier1Status } from "../tier1/gate.js";

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
export function executeReport(opts: ReportOptions): number {
  const mdPath = opts.out ?? resolve(opts.repoRoot, "duckadrift-report.md");
  const jsonPath = mdPath.replace(/\.md$/i, "") + ".json";

  try {
    const ctx = loadAdrLog(opts.repoRoot, opts.prContextPath, opts.adrDir);
    const findings = runAllTierZeroChecks(ctx);

    // Second config load is quiet: loadAdrLog's internal load already emitted
    // any per-run notices (config/load.ts documents this contract).
    const tier1 = resolveTier1Status(
      loadConfig(opts.repoRoot, { quiet: true }).tier1,
      tier1CredentialsPresent(),
      ctx
    );
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
