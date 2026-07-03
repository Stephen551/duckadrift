import { dirname } from "node:path";
import { REQUIRED_SECTIONS, sectionSatisfied } from "../adr/dialect.js";
import { formatAdrRef, padAdrNumber } from "../adr/refs.js";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
import type { Finding } from "../types.js";

const VALID_STATUSES = new Set(["proposed", "accepted", "rejected", "superseded", "deprecated"]);

const DUPLICATE_CONSEQUENCE =
  "Duplicate numbering makes ADR references ambiguous; downstream ghost-reference and status-graph checks cannot resolve a single target.";
// Found running R5's opendatahub: a number reused across per-team
// subdirectories may be an intentional convention, not a mistake — the tool
// can't disprove that, so (ADR-0008) it can't assert the cross-directory
// case as fact the way a same-directory collision still is.
const CROSS_DIRECTORY_CONSEQUENCE =
  "A number reused across directories may be an intentional per-directory namespace, or a genuine collision — declare `numbering: global` in `.duckadrift.yml` if this repo's numbers must be unique across the whole log.";

function titleCase(heading: string): string {
  return heading
    .split(" ")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// dirname() on a bare root-level filename ("0001-foo.md") returns "." —
// "the ADR root" reads better in a claim than a bare dot.
function directoryLabel(dir: string): string {
  return dir === "." ? "the ADR root" : `\`${dir}/\``;
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

  // ADR-0008: the numbering namespace is the directory, not the whole ADR
  // root, unless the repo declares numbering: global. Same-directory is
  // still an unexplainable, provable collision — fact-tier either way.
  if (ctx.numberingScope === "global") {
    for (const [number, group] of byNumber) {
      if (group.length > 1) {
        findings.push({
          check: "D1",
          claim: `ADR number ${padAdrNumber(number)} is claimed by ${group.length} files.`,
          evidence: group.map((a) => ({ adr: a.fileName })),
          consequence: DUPLICATE_CONSEQUENCE,
        });
      }
    }
  } else {
    for (const [number, group] of byNumber) {
      if (group.length <= 1) continue;

      const byDirectory = new Map<string, ParsedAdr[]>();
      for (const adr of group) {
        const dir = dirname(adr.fileName);
        const dirGroup = byDirectory.get(dir) ?? [];
        dirGroup.push(adr);
        byDirectory.set(dir, dirGroup);
      }

      for (const [dir, dirGroup] of byDirectory) {
        if (dirGroup.length <= 1) continue;
        findings.push({
          check: "D1",
          claim: `ADR number ${padAdrNumber(number)} is claimed by ${dirGroup.length} files in ${directoryLabel(dir)}.`,
          evidence: dirGroup.map((a) => ({ adr: a.fileName })),
          consequence: DUPLICATE_CONSEQUENCE,
        });
      }

      if (byDirectory.size > 1) {
        const dirLabels = [...byDirectory.keys()].map(directoryLabel).join(", ");
        findings.push({
          check: "D1",
          claim: `ADR number ${padAdrNumber(number)} is claimed by files in ${byDirectory.size} different directories (${dirLabels}).`,
          evidence: group.map((a) => ({ adr: a.fileName })),
          consequence: CROSS_DIRECTORY_CONSEQUENCE,
          advisory: true,
        });
      }
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
      if (!sectionSatisfied(req, headings)) {
        // A guessed dialect is a guess: asserting "missing" as fact when the
        // user never declared their template would be exactly the kind of
        // confident-but-wrong claim Tier 0's zero-false-positive contract
        // forbids (ADR-0005). Declared dialects still fail CI as before.
        findings.push({
          check: "D1",
          claim: `${adr.number !== null ? formatAdrRef(adr.number) : adr.fileName} is missing the required \`## ${titleCase(req)}\` section for its dialect.`,
          evidence: [{ adr: adr.fileName }],
          consequence: "A decision record with no recorded decision fails its one job.",
          ...(ctx.dialectDeclared ? {} : { advisory: true }),
        });
      }
    }
  }

  return findings;
}
