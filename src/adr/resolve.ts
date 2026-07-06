import { decodeTarget } from "./parse.js";
import { resolveWithinRepo } from "./paths.js";
import { walkAllPaths } from "../repo/walk.js";

/**
 * Build the site-relative basename finder the resolver's step 4 uses, shared by
 * D3 and D7. A link written for a published doc site's URL depth (MkDocs /
 * Docusaurus "pretty URLs" — extensionless, often trailing-slash) resolves in
 * the raw tree if a file with the same basename exists anywhere (ADR-0011). The
 * repo walk is lazy — only performed the first time a reference fails to resolve
 * directly — and cached for the rest of the run.
 */
export function makeBasenameFinder(repoRoot: string): (target: string) => string | undefined {
  let basenameIndex: Map<string, string> | null = null;
  let indexDirIndex: Map<string, string> | null = null;
  const build = (): void => {
    if (basenameIndex) return;
    basenameIndex = new Map();
    indexDirIndex = new Map();
    for (const f of walkAllPaths(repoRoot)) {
      const segments = f.relativePath.split("/");
      const base = segments[segments.length - 1]!;
      if (!basenameIndex.has(base)) basenameIndex.set(base, f.relativePath);
      if (base.toLowerCase() === "index.md" && segments.length >= 2) {
        const parentDir = segments[segments.length - 2]!;
        if (!indexDirIndex.has(parentDir)) indexDirIndex.set(parentDir, f.relativePath);
      }
    }
  };
  return (target: string): string | undefined => {
    build();
    const stripped = target.replace(/\/+$/, "");
    const slug = stripped.split("/").pop()!;
    if (slug === "") return undefined;
    const direct = basenameIndex!.get(slug);
    if (direct !== undefined) return direct;
    if (!/\.[a-z0-9]+$/i.test(slug)) {
      const withMd = basenameIndex!.get(`${slug}.md`);
      if (withMd !== undefined) return withMd;
      const asIndexDir = indexDirIndex!.get(slug);
      if (asIndexDir !== undefined) return asIndexDir;
    }
    return undefined;
  };
}

// A URL scheme (`https:`, `mailto:`, …). The one external-reference primitive,
// shared so D3's link skip and D7's index-entry skip can't drift: a reference
// with an external scheme is not an on-disk path and is never resolved or
// existence-checked (D3 has always skipped these; D7 used to reconcile them
// against the directory — the B-1 clause-A false positive).
export const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

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
  /** Site-relative basename lookup — walks the repo tree only (containment-safe). */
  findByBasename: (t: string) => string | undefined;
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
  if (found !== undefined) return { status: "site-relative-advisory", resolvedPath: found };

  return { status: "dangling" };
}
