import { relative, sep } from "node:path";
import { decodeTarget, scanLinks } from "../adr/parse.js";
import { escapesRepoRoot, resolveWithinRepo } from "../adr/paths.js";
import { isExternalReference, resolveReference } from "../adr/resolve.js";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
import { code } from "../report/write.js";
import type { Finding } from "../types.js";

// An index entry lives in some list structure — a markdown table row
// (`| ... |`) or a bullet/numbered list item (`* [...]`, `- [...]`, `1. [...]`)
// — never in a plain prose paragraph. A "see also" link in the intro prose
// is neither (ADR-0004: a real project's index cites an unrelated doc in its
// opening paragraph, which an unscoped scan misread as a stale entry). This is
// now a POST-parse classifier on a link's start line, not a pre-parse line
// filter: the index is parsed whole (NEW-A) so a valid multi-line CommonMark
// link parses correctly, then a link is kept as an entry iff its start line
// carries a list/table marker. (A pre-parse `.join` of only marker lines dropped
// the continuation line of `* [id](\n  path)`, broke the link, and falsely
// reported the ADR unlisted. Fully dropping the marker check would need the gfm
// mdast extension to keep table-index support — a new dependency — so the check
// stays, but off the parse path.)
const INDEX_ENTRY_LINE_RE = /^\s*(?:\||[-*+]\s|\d+\.\s)/;

/**
 * Internal index entries, via the shared mdast scanner (target + rawTarget).
 * External references (a URL scheme, protocol-relative) are dropped here exactly
 * as D3 drops external links; a pure-anchor/empty target is not an entry.
 * Whether an entry points at something real is the resolver's call downstream,
 * not the filename's shape (the old `/\.md$/` filter was the B-1/B-2 bug).
 */
function indexEntries(indexContent: string): { target: string; rawTarget: string }[] {
  const lines = indexContent.split(/\r?\n/);
  return scanLinks(indexContent)
    .filter((l) => !l.malformed && l.target !== "" && !isExternalReference(l.target))
    .filter((l) => {
      const startLine = lines[l.line - 1];
      return startLine !== undefined && INDEX_ENTRY_LINE_RE.test(startLine);
    })
    .map((l) => ({ target: l.target, rawTarget: l.rawTarget }));
}

/** D7: log/index drift — only applies if an index file is present (PDR §2.3). */
export function d7LogIndexDrift(ctx: AdrLogContext): Finding[] {
  if (!ctx.indexContent || !ctx.indexPath) return [];
  const findings: Finding[] = [];
  const indexRelPath = relative(ctx.repoRoot, ctx.indexPath).split("\\").join("/");

  const entries = indexEntries(ctx.indexContent);
  // A README that isn't a per-ADR index (links zero decisions — a policy page,
  // or one pointing elsewhere for the real TOC) should not make the tool assert
  // every ADR is missing. Zero recognized entries → not functioning as an index.
  if (entries.length === 0) return [];

  // Map each ADR to its repo-relative path, so an index entry that resolves to
  // that path counts the ADR as listed — this is the consolidation: D7 answers
  // "is this listed?" by resolving the entry through the one shared resolver
  // (G1: a path-form entry `../adr/0001-foo.md` now resolves to the file), not
  // by basename-set membership with an ad-hoc slash strip that diverged from D3.
  const adrByRepoPath = new Map<string, ParsedAdr>();
  for (const adr of ctx.adrs) {
    adrByRepoPath.set(relative(ctx.repoRoot, adr.filePath).split(sep).join("/"), adr);
  }
  // NEW-D: D7's "does this entry resolve?" is strict — the cited path itself must
  // exist (relative to the ADR/index dir or the repo root), with `.md` inference
  // for the extensionless site-relative case only (B-2: `0002-b` -> 0002-b.md).
  // The whole-repo same-basename fallback D3 uses for its advisory is dropped
  // here: an entry pointing at `old/site/path/0001-a.md` whose basename happens
  // to match a real `0001-a.md` at a DIFFERENT path is a stale entry, not a
  // resolution — the ADR it should list is then correctly reported "not listed."
  const inferExtension = (target: string): string | undefined => {
    const stripped = target.replace(/\/+$/, "");
    const base = stripped.split("/").pop() ?? "";
    if (base === "" || /\.[a-z0-9]+$/i.test(base)) return undefined; // already has an extension
    const withMd = `${stripped}.md`;
    return withMd.startsWith("/")
      ? resolveWithinRepo(ctx.repoRoot, withMd.replace(/^\/+/, ""), ctx.repoRoot)
      : resolveWithinRepo(ctx.adrDir, withMd, ctx.repoRoot) ??
        resolveWithinRepo(ctx.repoRoot, withMd, ctx.repoRoot);
  };

  const listed = new Set<string>(); // adr.fileName values an entry resolved to
  const reportedUnresolved = new Set<string>();
  for (const entry of entries) {
    const result = resolveReference({
      baseDir: ctx.adrDir,
      target: entry.target,
      rawTarget: entry.rawTarget,
      repoRoot: ctx.repoRoot,
      findByBasename: inferExtension,
    });
    if (result.status !== "dangling" && result.resolvedPath !== undefined) {
      // Resolved — to an ADR (mark it listed) or to a non-ADR companion file
      // (real, not drift). Same disposition D3 reaches on the same target (F5).
      const adr = adrByRepoPath.get(result.resolvedPath);
      if (adr) listed.add(adr.fileName);
      continue;
    }
    // The index lists something that resolves to nothing in the repo.
    const displayed = decodeTarget(entry.target).replace(/^\.?\//, "");
    if (reportedUnresolved.has(displayed)) continue;
    reportedUnresolved.add(displayed);
    // Honest wording, containment-safe: a target that escapes the repo root
    // under both resolutions is an escape, not an in-directory miss — and
    // escapesRepoRoot is purely lexical, so the claim is identical whether or
    // not an outside file happens to exist (no filesystem-probe leak).
    const outsideRepo =
      escapesRepoRoot(ctx.adrDir, displayed, ctx.repoRoot) &&
      escapesRepoRoot(ctx.repoRoot, displayed, ctx.repoRoot);
    findings.push({
      check: "D7",
      claim: outsideRepo
        ? `The ADR index lists ${code(displayed)}, which resolves outside the repository.`
        : `The ADR index lists ${code(displayed)}, which does not exist in the directory.`,
      evidence: [{ file: indexRelPath }],
      consequence: "An index that disagrees with the directory misleads anyone who trusts the index as the table of contents.",
    });
  }

  for (const adr of ctx.adrs) {
    if (listed.has(adr.fileName)) continue;
    findings.push({
      check: "D7",
      claim: `${code(adr.fileName)} exists in the directory but is not listed in the ADR index.`,
      evidence: [{ file: indexRelPath }, { adr: adr.fileName }],
      consequence: "An index that disagrees with the directory misleads anyone who trusts the index as the table of contents.",
    });
  }

  return findings;
}
