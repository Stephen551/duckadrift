import { decodeTarget } from "./parse.js";
import { resolveWithinRepo } from "./paths.js";
import { walkAllPaths } from "../repo/walk.js";

/**
 * A basename hit: the primary path (first in deterministic walk order — the same
 * file this finder returned before issue #8) plus every other file that shares
 * the linked basename, sorted lexicographically, empty when the basename is
 * unique. The site-relative advisory names all candidates so a reader is not
 * pointed at one file as if it were the only one (ADR-0024).
 */
export interface BasenameHit {
  path: string;
  otherCandidates: string[];
}

/**
 * Build the site-relative basename finder the resolver's step 4 uses, shared by
 * D3 and D7. A link written for a published doc site's URL depth (MkDocs /
 * Docusaurus "pretty URLs" — extensionless, often trailing-slash) resolves in
 * the raw tree if a file with the same basename exists anywhere (ADR-0011). The
 * repo walk is lazy — only performed the first time a reference fails to resolve
 * directly — and cached for the rest of the run. Every file per basename is
 * indexed in walk order (issue #8); the primary is the first, unchanged.
 */
export function makeBasenameFinder(repoRoot: string): (target: string) => BasenameHit | undefined {
  let basenameIndex: Map<string, string[]> | null = null;
  let indexDirIndex: Map<string, string[]> | null = null;
  const build = (): void => {
    if (basenameIndex) return;
    basenameIndex = new Map();
    indexDirIndex = new Map();
    for (const f of walkAllPaths(repoRoot)) {
      const segments = f.relativePath.split("/");
      const base = segments[segments.length - 1]!;
      const forBase = basenameIndex.get(base) ?? (basenameIndex.set(base, []), basenameIndex.get(base)!);
      forBase.push(f.relativePath);
      if (base.toLowerCase() === "index.md" && segments.length >= 2) {
        const parentDir = segments[segments.length - 2]!;
        const forDir = indexDirIndex.get(parentDir) ?? (indexDirIndex.set(parentDir, []), indexDirIndex.get(parentDir)!);
        forDir.push(f.relativePath);
      }
    }
  };
  // Primary = first in walk order (the pre-issue-#8 selection, so every existing
  // resolution is unchanged); otherCandidates = the rest of the SAME list,
  // sorted lexicographically, empty when unique.
  const hit = (matches: string[]): BasenameHit => ({
    path: matches[0]!,
    otherCandidates: matches.slice(1).sort(),
  });
  return (target: string): BasenameHit | undefined => {
    build();
    const stripped = target.replace(/\/+$/, "");
    const slug = stripped.split("/").pop()!;
    if (slug === "") return undefined;
    const direct = basenameIndex!.get(slug);
    if (direct !== undefined) return hit(direct);
    if (!/\.[a-z0-9]+$/i.test(slug)) {
      const withMd = basenameIndex!.get(`${slug}.md`);
      if (withMd !== undefined) return hit(withMd);
      const asIndexDir = indexDirIndex!.get(slug);
      if (asIndexDir !== undefined) return hit(asIndexDir);
    }
    return undefined;
  };
}

// A URL scheme (`https:`, `mailto:`, …). The one external-reference primitive,
// shared so D3's link skip and D7's index-entry skip can't drift: a reference
// with an external scheme is not an on-disk path and is never resolved or
// existence-checked (D3 has always skipped these; D7 used to reconcile them
// against the directory — the B-1 clause-A false positive).
// At least TWO characters before the colon (RV-1): a real URL scheme is
// multi-character, while a one-letter "scheme" is a Windows drive letter —
// `C:/Users/…/leaked.md` is a leaked local path, not an external URL, and must
// be resolved and flagged, not skipped.
export const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

/**
 * True for a reference the checks skip rather than resolve on disk: an explicit
 * URL scheme, or a protocol-relative `//host/…` URL. Shared by D3 (link targets)
 * and D7 (index entries) so "what counts as external" has exactly one answer.
 */
export function isExternalReference(target: string): boolean {
  return EXTERNAL_SCHEME_RE.test(target) || target.startsWith("//");
}

export type ResolveStatus =
  | "resolved"
  | "raw-only-advisory"
  | "site-relative-advisory"
  | "malformed"
  | "dangling";

export interface ResolveResult {
  status: ResolveStatus;
  /** Repo-relative path (forward slashes) the reference resolved to, when it did. */
  resolvedPath?: string;
  /**
   * Other files sharing the resolved basename (site-relative-advisory only,
   * issue #8). Sorted, empty when the basename is unique. The advisory names
   * them so a reader can see every candidate; other statuses never set it.
   */
  otherCandidates?: string[];
}

export interface ResolveInput {
  /** Directory of the referencing file, for the markdown-relative reading. */
  baseDir: string;
  /** The normalized destination (scanner `target`). */
  target: string;
  /** The pre-title-strip destination (scanner `rawTarget`), for the ambiguity step. */
  rawTarget: string;
  repoRoot: string;
  /** True when the destination was malformed (unclosed angle). */
  malformed?: boolean;
  /**
   * Site-relative basename lookup — walks the repo tree only (containment-safe).
   * Accepts either a bare path (D7's extension-inference finder, which needs no
   * candidates) or a `BasenameHit` (the shared `makeBasenameFinder`, issue #8);
   * `resolveReference` normalizes both, so no caller outside this module changes.
   */
  findByBasename: (t: string) => string | BasenameHit | undefined;
}

/**
 * The one reference-resolution path — parse-normalized target in, disposition
 * out — that D3, D7, and D2 all call. Round one consolidated link extraction but
 * left three checks resolving references three ways (D7's basename-set
 * membership, D2's number-only parse); routing every check through this function
 * makes a future divergence structurally impossible rather than merely absent.
 *
 * This is the D3 ladder, extracted behavior-identical: (1) the normalized target
 * resolves directly → resolved; (2/3) the raw (pre-title-strip) form resolves
 * where the normalized one didn't → advisory ambiguity; (4/5) a same-basename
 * file exists elsewhere → site-relative advisory; (6) nothing resolves →
 * dangling. A malformed destination short-circuits to `malformed`. Decoding and
 * containment happen here, so D7 and D3 reach the same disposition on the same
 * percent-encoded target (F5), and a leading-slash repo-root reference is one
 * rule, not a per-check strip.
 */
export function resolveReference(input: ResolveInput): ResolveResult {
  if (input.malformed) return { status: "malformed" };

  const target = decodeTarget(input.target);
  const rawTarget = decodeTarget(input.rawTarget);
  const rawDiffers = rawTarget !== target;

  // A leading "/" is GitHub's repo-root-relative convention, not an OS-absolute
  // path; resolve it from the repo root. Otherwise: ADR-dir-relative first
  // (markdown-correct), repo-root-relative fallback (a real code-citation
  // convention). Both containment-checked (S1).
  const resolvePath = (t: string): string | undefined =>
    t.startsWith("/")
      ? resolveWithinRepo(input.repoRoot, t.replace(/^\/+/, ""), input.repoRoot)
      : resolveWithinRepo(input.baseDir, t, input.repoRoot) ??
        resolveWithinRepo(input.repoRoot, t, input.repoRoot);

  const direct = resolvePath(target);
  if (direct !== undefined) return { status: "resolved", resolvedPath: direct };

  if (rawDiffers) {
    const rawResolved = resolvePath(rawTarget);
    if (rawResolved !== undefined) return { status: "raw-only-advisory", resolvedPath: rawResolved };
  }

  const found = input.findByBasename(target) ?? (rawDiffers ? input.findByBasename(rawTarget) : undefined);
  if (found !== undefined) {
    const path = typeof found === "string" ? found : found.path;
    const otherCandidates = typeof found === "string" ? [] : found.otherCandidates;
    return { status: "site-relative-advisory", resolvedPath: path, otherCandidates };
  }

  return { status: "dangling" };
}
