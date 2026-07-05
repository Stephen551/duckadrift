import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { extractLinkTargets } from "../adr/parse.js";
import type { AdrLogContext } from "../adr/types.js";
import { code } from "../report/write.js";
import type { Finding } from "../types.js";

// An index entry lives in some list structure — a markdown table row
// (`| ... |`) or a bullet/numbered list item (`* [...]`, `- [...]`, `1. [...]`)
// — never in a plain prose paragraph. A "see also" link in the intro prose
// is neither (ADR-0004: a real project's index cites an unrelated doc in its
// opening paragraph, which an unscoped scan misread as a stale entry).
// Table-only was itself too narrow: found running R5's
// cosmos-sdk/edgex-docs/opendatahub, whose real indexes are bullet lists,
// not tables — scanning tables only found zero entries and flagged every
// real ADR as "missing from the index," the opposite failure from the same
// root cause (assuming one index shape is the only one that exists).
const INDEX_ENTRY_LINE_RE = /^\s*(?:\||[-*+]\s|\d+\.\s)/;

function indexEntryLinks(indexContent: string): string[] {
  // Keep only index-entry lines (table rows / list items), then extract targets
  // with the shared CommonMark-correct parser (parse.ts). Before consolidation
  // this used a private pre-C1 regex that truncated `foo(v2).md` at the first
  // paren, flagging a real parenthesized filename as unlisted — the same class
  // of link-parsing bug the ADR-body path had already fixed and this copy had
  // not. One parser now serves both.
  const entryLines = indexContent
    .split(/\r?\n/)
    .filter((line) => INDEX_ENTRY_LINE_RE.test(line))
    .join("\n");
  return extractLinkTargets(entryLines).map((l) => l.target);
}

/** D7: log/index drift — only applies if an index file is present (PDR §2.3). */
export function d7LogIndexDrift(ctx: AdrLogContext): Finding[] {
  if (!ctx.indexContent || !ctx.indexPath) return [];
  const findings: Finding[] = [];
  const indexRelPath = relative(ctx.repoRoot, ctx.indexPath).split("\\").join("/");

  const indexedFiles = new Set<string>();
  for (const rawTarget of indexEntryLinks(ctx.indexContent)) {
    const target = rawTarget.split("#")[0]!.trim().replace(/^\.?\//, "");
    if (/\.md$/i.test(target)) indexedFiles.add(target);
  }

  // A README.md living in the ADR directory is not necessarily a per-ADR
  // index — found running R5: some are policy pages ("how to write an ADR")
  // that link zero individual decisions, or explicitly point elsewhere for
  // the real table of contents. Zero recognized entries is a strong signal
  // this file isn't functioning as an index at all; asserting "every ADR is
  // missing from it" would be confidently wrong, not a real drift finding.
  // (A genuinely stale index — some entries, none matching current files —
  // still has indexedFiles.size > 0 and is still checked normally below.)
  if (indexedFiles.size === 0) return [];

  const actualFiles = new Set(ctx.adrs.map((a) => a.fileName));

  for (const indexed of indexedFiles) {
    // "Exists" means exists on disk, not "is itself an ADR" — found running
    // R5's terraform-provider-proxmox: a numbered "Reading Order" list (now
    // matched by the widened list-item scan) legitimately cites a companion
    // reference doc living in the same directory. It's a real file, just not
    // ADR_FILENAME_RE-shaped, so checking membership in ctx.adrs alone would
    // wrongly call it missing. Same two-step resolution as D3: ADR-dir-
    // relative first, repo-root-relative fallback.
    if (actualFiles.has(indexed)) continue;
    if (existsSync(resolve(ctx.adrDir, indexed))) continue;
    if (existsSync(resolve(ctx.repoRoot, indexed))) continue;
    findings.push({
      check: "D7",
      claim: `The ADR index lists ${code(indexed)}, which does not exist in the directory.`,
      evidence: [{ file: indexRelPath }],
      consequence: "An index that disagrees with the directory misleads anyone who trusts the index as the table of contents.",
    });
  }

  for (const adr of ctx.adrs) {
    if (indexedFiles.has(adr.fileName)) continue;
    findings.push({
      check: "D7",
      claim: `${code(adr.fileName)} exists in the directory but is not listed in the ADR index.`,
      evidence: [{ file: indexRelPath }, { adr: adr.fileName }],
      consequence: "An index that disagrees with the directory misleads anyone who trusts the index as the table of contents.",
    });
  }

  return findings;
}
