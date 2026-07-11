import { basename } from "node:path";
import { escapesRepoRoot, resolveWithinRepo } from "../adr/paths.js";
import type { AdrLogContext } from "../adr/types.js";
import { walkRepoFiles } from "../repo/walk.js";
import type { Tier1Finding } from "./citations.js";

// The deterministic dead-premise confirmation (ADR-0036), stage 2 of S5. It
// runs on code, no model, identically in replay and live: the recording
// supplies the model's extraction, the filesystem supplies the truth. A
// concretely-named referent — a dependency or a repository path — that is
// provably ABSENT is dead decay; a present referent, or a premise naming
// nothing concrete a filesystem can falsify, is not dead.
//
// Conservative BY CONSTRUCTION: this pass produces false NEGATIVES (a decayed
// premise phrased so it names no parseable referent is simply not confirmed)
// and ZERO false positives (only a concretely-named, provably-absent referent
// is called dead). For an uncalibrated, annex-only check a missed decay is
// tolerable; a healthy premise called decay is the failure this design
// eliminates. Do not add heuristics that guess.

export type PremiseVerdict =
  | { dead: true; referent: { kind: "dependency" | "path"; value: string } }
  | { dead: false; reason: "no-concrete-referent" | "referent-present" };

// A repository path token: contains a slash and ends in a file extension. A
// bare dotted module name with no slash is deliberately NOT matched — it is
// ambiguous with prose, and a false negative is acceptable where a false
// positive is not.
const PATH_TOKEN_RE = /[A-Za-z0-9_.\-/]*\/[A-Za-z0-9_.\-/]*\.[A-Za-z0-9]+/g;

// An npm package name: optional scope, lowercase start, no file extension, no
// bare slash (only a scoped `@scope/name` slash). Deliberately tight.
const PACKAGE_NAME_RE = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

// Dependency language that must sit in the quote for a package-name token to
// count as a dependency premise (not just any backticked word).
const DEPENDENCY_CONTEXT_RE = /\b(depend|package\.json|pinned|installed|npm|manifest|lockfile)\b/i;

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Backtick- or straight-quote-delimited spans in a quote — the ADR's own emphasis of a name. */
function delimitedTokens(text: string): string[] {
  const out: string[] = [];
  for (const re of [/`([^`]+)`/g, /'([^']+)'/g, /"([^"]+)"/g]) {
    for (const m of text.matchAll(re)) out.push(m[1]!);
  }
  return out;
}

/** Path-shaped tokens anywhere in the quote (delimited or bare). */
function pathTokens(text: string): string[] {
  return [...text.matchAll(PATH_TOKEN_RE)].map((m) => m[0]);
}

function looksLikePath(token: string): boolean {
  return token.includes("/") && /\.[A-Za-z0-9]+$/.test(token.split("/").pop() ?? "");
}

/** Every package.json at and under repoRoot, containment-safe and defensively parsed. */
function repoDependencyNames(ctx: Pick<AdrLogContext, "repoRoot">): Set<string> {
  const names = new Set<string>();
  for (const file of walkRepoFiles(ctx.repoRoot)) {
    if (basename(file.relativePath) !== "package.json") continue;
    // Containment: walkRepoFiles stays within repoRoot, but resolve defensively.
    if (resolveWithinRepo(ctx.repoRoot, file.relativePath, ctx.repoRoot) === undefined) continue;
    let pkg: unknown;
    try {
      pkg = JSON.parse(file.content);
    } catch {
      continue; // a malformed manifest is not a place a dependency is "present"
    }
    if (typeof pkg !== "object" || pkg === null) continue;
    for (const section of DEP_SECTIONS) {
      const deps = (pkg as Record<string, unknown>)[section];
      if (typeof deps === "object" && deps !== null) {
        for (const name of Object.keys(deps)) names.add(name);
      }
    }
  }
  return names;
}

/**
 * Confirms whether a validated S5 finding names a concrete referent that is
 * provably absent from the repository. Referents are read from the finding's
 * already-byte-validated citation quotes (not free prose). A finding may name
 * more than one; a single provably-absent referent makes the finding real
 * decay, so the first dead referent wins, then presence, then no-referent.
 */
export function confirmDeadPremise(finding: Tier1Finding, ctx: AdrLogContext): PremiseVerdict {
  const quotes = finding.citations.map((c) => c.quote);

  // --- Path referents first: any path token that is absent within the repo is
  // dead. A token that lexically ESCAPES the repo root is not a repository
  // premise at all — it is not decay (the containment control), so it is not
  // treated as a concrete referent here.
  const pathCandidates = new Set<string>();
  for (const quote of quotes) for (const t of pathTokens(quote)) pathCandidates.add(t);
  let sawConcretePath = false;
  for (const token of pathCandidates) {
    if (escapesRepoRoot(ctx.repoRoot, token, ctx.repoRoot)) continue; // not a repo premise
    sawConcretePath = true;
    if (resolveWithinRepo(ctx.repoRoot, token, ctx.repoRoot) === undefined) {
      return { dead: true, referent: { kind: "path", value: token } };
    }
  }

  // --- Dependency referents: a package-name token the quote frames with
  // dependency language, absent from every manifest, is dead.
  const depNames = repoDependencyNames(ctx);
  let sawConcreteDependency = false;
  for (const quote of quotes) {
    if (!DEPENDENCY_CONTEXT_RE.test(quote)) continue;
    for (const token of delimitedTokens(quote)) {
      if (looksLikePath(token)) continue; // handled as a path above
      if (!PACKAGE_NAME_RE.test(token)) continue;
      sawConcreteDependency = true;
      if (!depNames.has(token)) {
        return { dead: true, referent: { kind: "dependency", value: token } };
      }
    }
  }

  if (sawConcretePath || sawConcreteDependency) {
    return { dead: false, reason: "referent-present" };
  }
  return { dead: false, reason: "no-concrete-referent" };
}

/**
 * Whether ONE named referent is absent from a repository root — the EXACT
 * existence checks the confirmation above runs, exported so the M4.3 labeling
 * annotation can probe the same referent against a second tree (committed vs
 * live disk) without duplicating the logic. Off every verdict path: only the
 * review-generation tooling calls this.
 */
export function referentAbsent(
  referent: { kind: "dependency" | "path"; value: string },
  repoRoot: string
): boolean {
  if (referent.kind === "path") {
    return resolveWithinRepo(repoRoot, referent.value, repoRoot) === undefined;
  }
  return !repoDependencyNames({ repoRoot }).has(referent.value);
}
