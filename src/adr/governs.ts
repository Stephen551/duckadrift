import { relative, sep } from "node:path";
import { minimatch } from "minimatch";

// The one governed-path matcher (ADR-0029). D5 ratified these semantics; the
// Tier 1 relevance gate needs the same ones. Copying them into the gate would
// be the parallel-primitive failure (the adversarial-consolidation root cause)
// reborn — so the primitive is extracted once and both consumers import it.
// Check policy (D5's ACK parsing and ADR-self-modification exemption) stays in
// D5: it is policy, not path matching, and the gate deliberately takes neither
// exemption.

/** Repo-root-relative path of an ADR file, forward-slash normalized. */
export function adrRepoPath(repoRoot: string, adrFilePath: string): string {
  // Exact repo-relative-path identity is the caller's contract (B-4: a suffix
  // match let `backup-0001-foo.md` count as "the PR modified the ADR").
  return relative(repoRoot, adrFilePath).split(sep).join("/");
}

/**
 * The governed-path match D5 ratified: minimatch with { dot: true } so governed
 * dotfile paths are matched, never silently skipped (B-6). Returns the changed
 * files that fall under any of the globs.
 */
export function governedTouches(changedFiles: string[], globs: string[]): string[] {
  return changedFiles.filter((f) => globs.some((g) => minimatch(f, g, { dot: true })));
}
