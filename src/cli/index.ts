#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAdrLog } from "../adr/load.js";
import { runAllTierZeroChecks } from "../checks/index.js";
import { SetupError } from "../errors.js";
import { buildJsonReport, renderMarkdownReport } from "../report/write.js";

function printUsage(): void {
  console.log(
    [
      "duckadrift — verifies an ADR log against reality.",
      "",
      "Usage:",
      "  duckadrift check [path] [--pr-context <file>] [--adr-dir <path>]",
      "  duckadrift report [path] [--pr-context <file>] [--adr-dir <path>] [--out <file>]",
      "",
      "path defaults to the current directory.",
      "--adr-dir overrides auto-detection (docs/adr, doc/adr) for repos that",
      "keep their ADR log elsewhere. Relative paths resolve against [path].",
    ].join("\n")
  );
}

function parseCommonArgs(
  argv: string[]
): { repoRoot: string; prContextPath?: string; out?: string; adrDir?: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "pr-context": { type: "string" },
      out: { type: "string" },
      "adr-dir": { type: "string" },
    },
    allowPositionals: true,
  });
  return {
    repoRoot: resolve(positionals[0] ?? "."),
    ...(values["pr-context"] !== undefined ? { prContextPath: values["pr-context"] } : {}),
    ...(values.out !== undefined ? { out: values.out } : {}),
    ...(values["adr-dir"] !== undefined ? { adrDir: values["adr-dir"] } : {}),
  };
}

function runCheck(argv: string[]): void {
  const { repoRoot, prContextPath, adrDir } = parseCommonArgs(argv);
  const ctx = loadAdrLog(repoRoot, prContextPath, adrDir);
  const findings = runAllTierZeroChecks(ctx);

  if (findings.length === 0) {
    // A clean bill of health that hides an unscanned file is itself the
    // silent-partial-coverage violation ADR-0007 exists to prevent — the
    // zero-findings fast path still has to say what it didn't recognize.
    console.log("duckadrift: 0 Tier 0 findings.");
    if (ctx.unrecognizedFiles.length > 0) {
      console.log(
        `duckadrift: ${ctx.unrecognizedFiles.length} file(s) under the ADR root were not recognized as an ADR or the index:`
      );
      for (const f of ctx.unrecognizedFiles) console.log(`  - ${f}`);
    }
    process.exitCode = 0;
    return;
  }

  const failing = findings.filter((f) => !f.advisory).length;

  console.log(renderMarkdownReport(findings, ctx.unrecognizedFiles));
  if (failing === 0) {
    console.error(
      `duckadrift: ${findings.length} Tier 0 finding(s), all advisory — not failing (dialect not declared, ADR-0005).`
    );
    process.exitCode = 0;
    return;
  }
  console.error(
    `duckadrift: ${failing} Tier 0 finding(s) — failing (Tier 0 findings fail CI by contract).`
  );
  process.exitCode = 1;
}

function runReport(argv: string[]): void {
  const { repoRoot, prContextPath, out, adrDir } = parseCommonArgs(argv);
  const ctx = loadAdrLog(repoRoot, prContextPath, adrDir);
  const findings = runAllTierZeroChecks(ctx);

  const markdown = renderMarkdownReport(findings, ctx.unrecognizedFiles);
  const adrDirRelative = relative(repoRoot, ctx.adrDir).split("\\").join("/");
  const json = buildJsonReport(findings, adrDirRelative, ctx.unrecognizedFiles);
  const mdPath = out ?? resolve(repoRoot, "duckadrift-report.md");
  const jsonPath = mdPath.replace(/\.md$/i, "") + ".json";

  writeFileSync(mdPath, markdown, "utf-8");
  writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8");

  const failing = findings.filter((f) => !f.advisory).length;
  console.log(
    `duckadrift: wrote ${mdPath} and ${jsonPath} (${findings.length} Tier 0 finding(s), ${failing} failing).`
  );
  process.exitCode = 0;
}

function main(): void {
  const [, , command, ...rest] = process.argv;

  try {
    switch (command) {
      case "check":
        runCheck(rest);
        break;
      case "report":
        runReport(rest);
        break;
      default:
        printUsage();
        process.exitCode = command === undefined ? 0 : 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`duckadrift: ${message}`);
    // Exit 2: environment/setup problem (no ADR log yet, bad flag) — nothing
    // was checked, so nothing failed. Exit 1 (below) means findings failed.
    // The Action wrapper treats these differently (Gate G2): a stranger's
    // first install shouldn't see a red X before they've written an ADR.
    process.exitCode = err instanceof SetupError ? 2 : 1;
  }
}

main();
