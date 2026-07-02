import { relative } from "node:path";
import type { AdrLogContext } from "../adr/types.js";
import type { Finding } from "../types.js";

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/** D7: log/index drift — only applies if an index file is present (PDR §2.3). */
export function d7LogIndexDrift(ctx: AdrLogContext): Finding[] {
  if (!ctx.indexContent || !ctx.indexPath) return [];
  const findings: Finding[] = [];
  const indexRelPath = relative(ctx.repoRoot, ctx.indexPath).split("\\").join("/");

  const indexedFiles = new Set<string>();
  for (const match of ctx.indexContent.matchAll(LINK_RE)) {
    const target = match[1]!.split("#")[0]!.trim().replace(/^\.?\//, "");
    if (/\.md$/i.test(target)) indexedFiles.add(target);
  }

  const actualFiles = new Set(ctx.adrs.map((a) => a.fileName));

  for (const indexed of indexedFiles) {
    if (actualFiles.has(indexed)) continue;
    findings.push({
      check: "D7",
      claim: `The ADR index lists \`${indexed}\`, which does not exist in the directory.`,
      evidence: [{ file: indexRelPath }],
      consequence: "An index that disagrees with the directory misleads anyone who trusts the index as the table of contents.",
    });
  }

  for (const adr of ctx.adrs) {
    if (indexedFiles.has(adr.fileName)) continue;
    findings.push({
      check: "D7",
      claim: `\`${adr.fileName}\` exists in the directory but is not listed in the ADR index.`,
      evidence: [{ file: indexRelPath }, { adr: adr.fileName }],
      consequence: "An index that disagrees with the directory misleads anyone who trusts the index as the table of contents.",
    });
  }

  return findings;
}
