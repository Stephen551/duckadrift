import { formatAdrRef, parseAdrRef } from "../adr/refs.js";
import type { AdrLogContext } from "../adr/types.js";
import { walkRepoFiles } from "../repo/walk.js";
import type { Finding } from "../types.js";

const ADR_MENTION_RE = /\bADR-(\d+)\b/gi;
const DEAD_STATUSES = new Set(["superseded", "rejected"]);

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** D4: ghost references — code/comments/docs citing a Superseded or Rejected ADR (PDR §2.3). */
export function d4GhostReferences(ctx: AdrLogContext): Finding[] {
  const findings: Finding[] = [];
  const byNumber = new Map<number, (typeof ctx.adrs)[number]>();
  for (const adr of ctx.adrs) {
    if (adr.number !== null) byNumber.set(adr.number, adr);
  }

  // Only code/comments/docs OUTSIDE the ADR log itself — an ADR's own prose
  // legitimately names the decisions it supersedes; that's D2's job, not D4's.
  const files = walkRepoFiles(ctx.repoRoot).filter((f) => !f.absolutePath.startsWith(ctx.adrDir));

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const match of line.matchAll(ADR_MENTION_RE)) {
        const num = Number.parseInt(match[1]!, 10);
        const target = byNumber.get(num);
        const status = target?.frontmatter.status;
        if (!target || !status || !DEAD_STATUSES.has(status)) continue;

        const supersededBy = parseAdrRef(target.frontmatter["superseded-by"]);
        const suffix = supersededBy !== null ? ` (by ${formatAdrRef(supersededBy)})` : "";
        findings.push({
          check: "D4",
          claim: `\`${file.relativePath}\` cites ${formatAdrRef(num)} as governing, but ${formatAdrRef(num)} is ${capitalize(status)}${suffix}.`,
          evidence: [
            { file: file.relativePath, line: idx + 1 },
            { adr: target.fileName },
          ],
          consequence: "Code that cites a dead decision as live is following guidance the project has already retracted.",
        });
      }
    });
  }

  return findings;
}
