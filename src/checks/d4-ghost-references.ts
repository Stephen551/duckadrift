import { formatAdrRef, parseAdrRef } from "../adr/refs.js";
import { isPathInside } from "../adr/paths.js";
import { effectiveStatus } from "../adr/status.js";
import type { AdrLogContext } from "../adr/types.js";
import { walkRepoFiles } from "../repo/walk.js";
import { code } from "../report/write.js";
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
  // Boundary-aware, not a substring test: `startsWith(adrDir)` also matched a
  // sibling `docs/adr-extra/` and wrongly skipped its ghost references (B-8).
  const files = walkRepoFiles(ctx.repoRoot).filter((f) => !isPathInside(ctx.adrDir, f.absolutePath));

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const match of line.matchAll(ADR_MENTION_RE)) {
        const num = Number.parseInt(match[1]!, 10);
        const target = byNumber.get(num);
        const status = target ? effectiveStatus(target).value : null;
        if (!target || !status || !DEAD_STATUSES.has(status)) continue;

        const supersededBy = parseAdrRef(target.frontmatter["superseded-by"]);
        const suffix = supersededBy !== null ? ` (by ${formatAdrRef(supersededBy)})` : "";
        // A grep match proves the file names a dead ADR; it cannot prove the
        // file treats that ADR as still-governing (C5, ADR-0013). A changelog
        // or migration note documenting the supersession names the same
        // number the same way a stale code citation would — the earlier
        // "cites ADR-N as governing" wording asserted an intent a string
        // match can't support, and failed CI on ordinary history notes. The
        // claim now states only the provable fact — a reference to a dead ADR
        // exists — and is advisory: surfaced for a human to judge stance,
        // never blocking (ADR-0005, provable-state-not-provable-error).
        findings.push({
          check: "D4",
          claim: `${code(file.relativePath)} references ${formatAdrRef(num)}, which is ${capitalize(status)}${suffix}.`,
          evidence: [
            { file: file.relativePath, line: idx + 1 },
            { adr: target.fileName },
          ],
          consequence:
            "A file naming a superseded or rejected ADR may be relying on it as current or merely recording its history — a name match can't tell which, so this is surfaced for a human to judge rather than failed.",
          advisory: true,
        });
      }
    });
  }

  return findings;
}
