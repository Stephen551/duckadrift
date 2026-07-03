#!/usr/bin/env node
// Translates report.json findings into GitHub Actions workflow commands
// (::error::/::notice::), which GitHub renders as inline PR annotations when
// the evidence carries a file+line. Fact findings are errors (fail the
// check); advisory findings (ADR-0005) are notices — visible, never blocking.
import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: emit-annotations.mjs <report.json path>");
  process.exit(1);
}

// GitHub workflow-command escaping: https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
function escapeData(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(s) {
  return escapeData(s).replace(/,/g, "%2C").replace(/:/g, "%3A");
}

const report = JSON.parse(readFileSync(reportPath, "utf-8"));

// evidence.file is already repo-root-relative. evidence.adr is a bare
// filename (e.g. "0001-example.md") inside the ADR directory — prefix it
// with adrDirRelative to get a path GitHub can anchor an annotation to.
function resolveEvidencePath(ev) {
  if (ev.file) return ev.file;
  if (ev.adr) return `${report.adrDirRelative}/${ev.adr}`;
  return null;
}

for (const finding of report.tier0Findings) {
  const level = finding.advisory ? "notice" : "error";
  const located = finding.evidence.find((e) => e.line !== undefined && resolveEvidencePath(e));
  const props = [`title=duckadrift ${finding.check}`];
  if (located) {
    props.push(`file=${escapeProperty(resolveEvidencePath(located))}`);
    props.push(`line=${located.line}`);
  }
  console.log(`::${level} ${props.join(",")}::${escapeData(finding.claim)}`);
}

console.log(`Emitted ${report.tier0Findings.length} annotation(s).`);
