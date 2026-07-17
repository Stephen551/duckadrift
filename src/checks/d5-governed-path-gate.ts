import { adrRepoPath, governedTouches } from "../adr/governs.js";
import { formatAdrRef, padAdrNumber } from "../adr/refs.js";
import { isAccepted } from "../adr/status.js";
import type { AdrLogContext } from "../adr/types.js";
import { code } from "../report/write.js";
import type { Finding } from "../types.js";

// An acknowledgement marker must stand on its own line — a deliberate trailer,
// not a phrase buried in prose (B-5: `ADR-ACK: N` matched anywhere let an
// incidental mention in the PR body silently ack a governed change). The `m`
// flag anchors `^`/`$` to line boundaries, so the whole line must be the marker.
const ACK_RE = /^[ \t]*ADR-ACK:[ \t]*(\d+)[ \t]*$/gim;

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
    if (adr.number === null || !isAccepted(adr)) continue;
    const globs = adr.frontmatter.governs;
    if (!globs || globs.length === 0) continue;
    if (acked.has(adr.number)) continue;
    // Exact repo-relative-path identity, not a suffix match: `endsWith` let an
    // unrelated `backup-0001-foo.md` count as "the PR modified the ADR" and slip
    // the gate (B-4). changedFiles are repo-root-relative (git diff), forward-slash.
    // Path matching lives in the shared primitive (src/adr/governs.ts, ADR-0029);
    // the ACK and self-modification exemptions above and below stay here — they
    // are check policy, and the Tier 1 gate deliberately takes neither.
    const selfPath = adrRepoPath(ctx.repoRoot, adr.filePath);
    if (changedFiles.some((f) => f === selfPath)) continue; // PR modifies the ADR itself

    const touched = governedTouches(changedFiles, globs);
    if (touched.length === 0) continue;

    findings.push({
      check: "D5",
      claim: `PR touches ${touched.map((f) => code(f)).join(", ")}, governed by Accepted ${formatAdrRef(adr.number)}, without modifying the ADR or carrying an ${code(`ADR-ACK: ${padAdrNumber(adr.number)}`)} marker.`,
      evidence: [{ adr: adr.fileName }, ...touched.map((f) => ({ file: f }))],
      consequence: "A silent change to a governed path bypasses the decision the team recorded to guard it.",
    });
  }

  return findings;
}
