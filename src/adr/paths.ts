import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Does `target` (resolved against `base`) lexically escape `repoRoot`? Pure path
 * math, no filesystem access — so a check that branches on this leaks nothing
 * about what exists on disk. Used both as the fast reject inside
 * `existsWithinRepo` and, by D7, to word an out-of-repo index target honestly
 * without probing for it.
 */
export function escapesRepoRoot(base: string, target: string, repoRoot: string): boolean {
  const rel = relative(repoRoot, resolve(base, target));
  return rel.startsWith("..") || isAbsolute(rel);
}

/**
 * Exists AND is inside the repository (S1, ADR-0013). The one containment
 * primitive both D3 and D7 import — before this it lived module-private in D3,
 * and D7's index-existence check was a raw `existsSync(resolve(...))` with no
 * containment, so a fork could read the runner's filesystem through CI pass/fail
 * (an index entry pointing outside the repo turned "the outside file exists"
 * into an exit-code the fork could observe). Consolidating here closes that for
 * every caller at once.
 *
 * The lexical guard rejects a path whose text escapes the repo root; a target
 * that survives it still gets a realpath re-check, because `existsSync` follows
 * symlinks and an in-repo symlink can resolve to an out-of-repo real file, which
 * is not "at HEAD." realpath runs only on the existsSync-true branch, so the
 * added syscall is bounded to resolving links; a broken link or a symlink cycle
 * makes it throw, treated as unresolved rather than a crash.
 */
export function existsWithinRepo(base: string, target: string, repoRoot: string): boolean {
  return resolveWithinRepo(base, target, repoRoot) !== undefined;
}

/**
 * Like `existsWithinRepo`, but returns the resolved path repo-relative (forward
 * slashes) when the target exists and is contained, else undefined. The
 * shared resolver uses this so D7 can map an index entry to the ADR file it
 * resolves to, not merely learn that it exists. Containment is identical to
 * `existsWithinRepo` (which now delegates here) — the S1 realpath guard stays.
 */
export function resolveWithinRepo(base: string, target: string, repoRoot: string): string | undefined {
  if (escapesRepoRoot(base, target, repoRoot)) return undefined; // escaped the repo root (lexical)
  const abs = resolve(base, target);
  if (!existsSync(abs)) return undefined;
  try {
    const realRel = relative(realpathSync(repoRoot), realpathSync(abs));
    if (realRel.startsWith("..") || isAbsolute(realRel)) return undefined;
  } catch {
    return undefined;
  }
  return relative(repoRoot, abs).split(sep).join("/");
}
