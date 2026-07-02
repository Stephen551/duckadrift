#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAdrLog } from "../adr/load.js";
import { runAllTierZeroChecks } from "../checks/index.js";
import { buildJsonReport, renderMarkdownReport } from "../report/write.js";

function printUsage(): void {
  console.log(
    [
      "duckadrift — verifies an ADR log against reality.",
      "",
      "Usage:",
      "  duckadrift check [path] [--pr-context <file>]",
      "  duckadrift report [path] [--pr-context <file>] [--out <file>]",
      "",
      "path defaults to the current directory.",
    ].join("\n")
  );
}

function parseCommonArgs(argv: string[]): { repoRoot: string; prContextPath?: string; out?: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "pr-context": { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: true,
  });
  return {
    repoRoot: resolve(positionals[0] ?? "."),
    ...(values["pr-context"] !== undefined ? { prContextPath: values["pr-context"] } : {}),
    ...(values.out !== undefined ? { out: values.out } : {}),
  };
}

function runCheck(argv: string[]): void {
  const { repoRoot, prContextPath } = parseCommonArgs(argv);
  const ctx = loadAdrLog(repoRoot, prContextPath);
  const findings = runAllTierZeroChecks(ctx);

  if (findings.length === 0) {
    console.log("duckadrift: 0 Tier 0 findings.");
    process.exitCode = 0;
    return;
  }

  console.log(renderMarkdownReport(findings));
  console.error(
    `duckadrift: ${findings.length} Tier 0 finding(s) — failing (Tier 0 findings fail CI by contract, PDR §2.5).`
  );
  process.exitCode = 1;
}

function runReport(argv: string[]): void {
  const { repoRoot, prContextPath, out } = parseCommonArgs(argv);
  const ctx = loadAdrLog(repoRoot, prContextPath);
  const findings = runAllTierZeroChecks(ctx);

  const markdown = renderMarkdownReport(findings);
  const json = buildJsonReport(findings);
  const mdPath = out ?? resolve(repoRoot, "duckadrift-report.md");
  const jsonPath = mdPath.replace(/\.md$/i, "") + ".json";

  writeFileSync(mdPath, markdown, "utf-8");
  writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8");

  console.log(`duckadrift: wrote ${mdPath} and ${jsonPath} (${findings.length} Tier 0 finding(s)).`);
  process.exitCode = 0;
}

function main(): void {
  const [, , command, ...rest] = process.argv;

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
}

main();
