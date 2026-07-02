import { minimatch } from "minimatch";
import { formatAdrRef, padAdrNumber } from "../adr/refs.js";
import type { AdrLogContext } from "../adr/types.js";
import type { Finding } from "../types.js";

const ACK_RE = /ADR-ACK:\s*(\d+)/gi;

function ackedNumbers(commitMessage: string | undefined, prBody: string | undefined): Set<number> {
  const acked = new Set<number>();
  for (const text of [commitMessage, prBody]) {
    if (!text) continue;
    for (const match of text.matchAll(ACK_RE)) {
      acked.add(Number.parseInt(match[1]!, 10));
    }
  }
  return acked;
}

/** D5: governed-path gate — the flagship deterministic check (PDR §2.3). Only runs in PR-diff mode. */
export function d5GovernedPathGate(ctx: AdrLogContext): Finding[] {
  if (!ctx.prContext) return [];
  const { changedFiles, commitMessage, prBody } = ctx.prContext;
  const acked = ackedNumbers(commitMessage, prBody);
  const findings: Finding[] = [];

  for (const adr of ctx.adrs) {
    if (adr.number === null || adr.frontmatter.status !== "accepted") continue;
    const globs = adr.frontmatter.governs;
    if (!globs || globs.length === 0) continue;
    if (acked.has(adr.number)) continue;
    if (changedFiles.some((f) => f.endsWith(adr.fileName))) continue; // PR modifies the ADR itself

    const touched = changedFiles.filter((f) => globs.some((g) => minimatch(f, g)));
    if (touched.length === 0) continue;

    findings.push({
      check: "D5",
      claim: `PR touches ${touched.map((f) => `\`${f}\``).join(", ")}, governed by Accepted ${formatAdrRef(adr.number)}, without modifying the ADR or carrying an \`ADR-ACK: ${padAdrNumber(adr.number)}\` marker.`,
      evidence: [{ adr: adr.fileName }, ...touched.map((f) => ({ file: f }))],
      consequence: "A silent change to a governed path bypasses the decision the team recorded to guard it.",
    });
  }

  return findings;
}
