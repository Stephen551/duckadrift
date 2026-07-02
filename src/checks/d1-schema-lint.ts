import { REQUIRED_SECTIONS } from "../adr/dialect.js";
import { formatAdrRef, padAdrNumber } from "../adr/refs.js";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
import type { Finding } from "../types.js";

const VALID_STATUSES = new Set(["proposed", "accepted", "rejected", "superseded", "deprecated"]);

function titleCase(heading: string): string {
  return heading
    .split(" ")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** D1: schema/structure lint — PDR §2.3. */
export function d1SchemaLint(ctx: AdrLogContext): Finding[] {
  const findings: Finding[] = [];
  const byNumber = new Map<number, ParsedAdr[]>();
  for (const adr of ctx.adrs) {
    if (adr.number === null) continue;
    const group = byNumber.get(adr.number) ?? [];
    group.push(adr);
    byNumber.set(adr.number, group);
  }

  for (const [number, group] of byNumber) {
    if (group.length > 1) {
      findings.push({
        check: "D1",
        claim: `ADR number ${padAdrNumber(number)} is claimed by ${group.length} files.`,
        evidence: group.map((a) => ({ adr: a.fileName })),
        consequence:
          "Duplicate numbering makes ADR references ambiguous; downstream ghost-reference and status-graph checks cannot resolve a single target.",
      });
    }
  }

  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1]!;
    const curr = numbers[i]!;
    if (curr - prev > 1) {
      const after = byNumber.get(curr)![0]!;
      for (let missing = prev + 1; missing < curr; missing++) {
        findings.push({
          check: "D1",
          claim: `ADR numbering skips ${padAdrNumber(missing)} between ${padAdrNumber(prev)} and ${padAdrNumber(curr)}.`,
          evidence: [{ adr: after.fileName }],
          consequence:
            "A skipped number is either a lost ADR or a numbering error; both need a human to confirm which.",
        });
      }
    }
  }

  for (const adr of ctx.adrs) {
    const status = adr.frontmatter.status;
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      findings.push({
        check: "D1",
        claim: `${adr.number !== null ? formatAdrRef(adr.number) : adr.fileName} has status \`${status}\`, which is not a valid status for this dialect.`,
        evidence: [{ adr: adr.fileName }],
        consequence:
          "An unrecognized status value makes this ADR invisible to status-graph and staleness checks that filter on valid statuses.",
      });
    }

    const required = REQUIRED_SECTIONS[adr.dialect];
    const headings = new Set(adr.sections.map((s) => s.heading.toLowerCase().trim()));
    for (const req of required) {
      if (!headings.has(req)) {
        findings.push({
          check: "D1",
          claim: `${adr.number !== null ? formatAdrRef(adr.number) : adr.fileName} is missing the required \`## ${titleCase(req)}\` section for its dialect.`,
          evidence: [{ adr: adr.fileName }],
          consequence: "A decision record with no recorded decision fails its one job.",
        });
      }
    }
  }

  return findings;
}
