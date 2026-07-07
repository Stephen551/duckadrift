import { relative, sep } from "node:path";
import { minimatch } from "minimatch";
import { formatAdrRef, padAdrNumber } from "../adr/refs.js";
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
    if (adr.number === null || adr.frontmatter.status !== "accepted") continue;
    const globs = adr.frontmatter.governs;
    if (!globs || globs.length === 0) continue;
    if (acked.has(adr.number)) continue;
    // Exact repo-relative-path identity, not a suffix match: `endsWith` let an
    // unrelated `backup-0001-foo.md` count as "the PR modified the ADR" and slip
    // the gate (B-4). changedFiles are repo-root-relative (git diff), forward-slash.
    const adrRepoPath = relative(ctx.repoRoot, adr.filePath).split(sep).join("/");
    if (changedFiles.some((f) => f === adrRepoPath)) continue; // PR modifies the ADR itself

    // { dot: true } so a governed dotfile path (`.github/workflows/ci.yml` under a
    // `**/*` glob) is matched, not silently skipped by minimatch's default (B-6).
    const touched = changedFiles.filter((f) => globs.some((g) => minimatch(f, g, { dot: true })));
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
