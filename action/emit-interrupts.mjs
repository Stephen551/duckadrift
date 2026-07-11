#!/usr/bin/env node
// The interrupt push (ADR-0042). Reads report.json; for each Tier 1 finding
// whose disposition is "interrupt" (its severity's channel OPEN and its
// confidence at or above the measured threshold), posts one PR review comment
// (PR mode) or opens/updates the interrupt issue (schedule mode) — analyst
// voice (PDR §3.1): claim → evidence → consequence → disposition, calibrated-
// band language, never raw decimals in prose, no duck.
//
// Under the shipped calibration every channel is closed, so this script's
// steady state is "0 interrupt(s) — nothing posted" WITHOUT ever invoking gh:
// the zero-interrupt path is provably network-free (the M4.4 action repro
// asserts exactly that).
//
// Usage: emit-interrupts.mjs <report.json> <pr|schedule> [pr-number]
// Requires gh + GH_TOKEN only when there is something to post.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [reportPath, mode, prNumber] = process.argv.slice(2);
if (!reportPath || !mode) {
  console.error("Usage: emit-interrupts.mjs <report.json path> <pr|schedule> [pr-number]");
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf-8"));
const tier1 = report.tier1;
const findings = tier1?.findings ?? [];
const dispositions = tier1?.dispositions ?? [];

const interrupts = findings
  .map((finding, i) => ({ finding, routed: dispositions[i] }))
  .filter((x) => x.routed?.disposition === "interrupt");

if (interrupts.length === 0) {
  // The steady state under the shipped calibration: nothing to push, no gh
  // invocation, no network. The annex in the job summary is the complete record.
  console.log("duckadrift interrupts: 0 interrupt(s) — nothing posted.");
  process.exit(0);
}

/** Analyst-voice body for one interrupting finding (§3.1). No raw decimals in prose; the calibrated band is the language. */
function interruptBody({ finding, routed }) {
  const lines = [
    `**duckadrift — ${finding.check} finding, ${routed.severity} severity (interrupt)**`,
    "",
    finding.claim,
    "",
    "Evidence:",
    ...finding.citations.map((c) => `> ${c.quote}\n> — ${c.document}`),
    "",
    `Consequence: ${finding.consequence}`,
    "",
    `Disposition: this finding's reported confidence sits at or above the calibrated interrupt threshold for ${routed.severity} findings (calibration ${tier1.calibration?.corpusHash?.slice(0, 12) ?? ""}, ${tier1.calibration?.source ?? ""} artifact). It also appears in the report annex — the interrupt is an additional push, not a relocation.`,
  ];
  return lines.join("\n");
}

if (mode === "pr") {
  if (!prNumber) {
    console.error("emit-interrupts: pr mode requires the PR number.");
    process.exit(1);
  }
  for (const item of interrupts) {
    execFileSync("gh", ["pr", "comment", prNumber, "--body", interruptBody(item)], {
      stdio: "inherit",
    });
  }
  console.log(`duckadrift interrupts: posted ${interrupts.length} PR comment(s).`);
} else if (mode === "schedule") {
  const title = "duckadrift: calibrated interrupt";
  const body = interrupts.map(interruptBody).join("\n\n---\n\n");
  const existing = execFileSync(
    "gh",
    ["issue", "list", "--search", `in:title "${title}"`, "--state", "open", "--json", "number", "--jq", ".[0].number // empty"],
    { encoding: "utf-8" }
  ).trim();
  if (existing) {
    execFileSync("gh", ["issue", "comment", existing, "--body", body], { stdio: "inherit" });
    console.log(`duckadrift interrupts: updated issue #${existing} with ${interrupts.length} interrupt(s).`);
  } else {
    execFileSync("gh", ["issue", "create", "--title", title, "--body", body], { stdio: "inherit" });
    console.log(`duckadrift interrupts: opened the interrupt issue (${interrupts.length} interrupt(s)).`);
  }
} else {
  console.error(`emit-interrupts: unknown mode ${JSON.stringify(mode)} — expected pr or schedule.`);
  process.exit(1);
}
