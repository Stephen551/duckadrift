import { relative, sep } from "node:path";
import { decodeTarget, scanLinks } from "../adr/parse.js";
import { escapesRepoRoot } from "../adr/paths.js";
import { makeBasenameFinder, resolveReference } from "../adr/resolve.js";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
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

/** Index entries that name a markdown file, via the shared scanner (target + rawTarget). */
function indexEntries(indexContent: string): { target: string; rawTarget: string }[] {
  const entryLines = indexContent
    .split(/\r?\n/)
    .filter((line) => INDEX_ENTRY_LINE_RE.test(line))
    .join("\n");
  return scanLinks(entryLines)
    .filter((l) => !l.malformed && /\.md$/i.test(l.target))
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
  const findByBasename = makeBasenameFinder(ctx.repoRoot);

  const listed = new Set<string>(); // adr.fileName values an entry resolved to
  const reportedUnresolved = new Set<string>();
  for (const entry of entries) {
    const result = resolveReference({
      baseDir: ctx.adrDir,
      target: entry.target,
      rawTarget: entry.rawTarget,
      repoRoot: ctx.repoRoot,
      findByBasename,
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
