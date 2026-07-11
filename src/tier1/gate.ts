import { governedTouches } from "../adr/governs.js";
import type { AdrLogContext } from "../adr/types.js";
import type { Tier1Config } from "../config/load.js";
import type { Tier1Status } from "../report/write.js";

// The deterministic relevance gate (ADR-0003, ADR-0029). PR-mode only:
// schedule mode's whole purpose (S5, decay sweeps) is drift no diff surfaces,
// so the gate does not apply there. The gate opens SPENDING, not verdicts: a
// false signal costs one gated eligibility, while a missed signal is still
// surfaced as the no-signal status — never silently absorbed. The precision
// demand is therefore asymmetric, and the named sets below may be generous.
//
// The third ADR-0003 signal — a cross-module boundary move — is deliberately
// NOT implemented: --name-only PR contexts represent renames as delete+add
// pairs, and inferring a move by basename-pairing is a heuristic. A guessed
// signal has no place in a deterministic gate. Declared in ADR-0029; it lands
// when the PR context carries rename metadata.

export type Tier1Signal =
  | { kind: "governed-path"; adr: string; files: string[] } // adr = fileName
  | { kind: "dependency-manifest"; files: string[] }
  | { kind: "storage-schema"; files: string[] };

export interface GateResult {
  decision: "signal" | "no-signal";
  signals: Tier1Signal[];
}

// Exact basename match, case-sensitive — the manifest names below are fixed
// vocabulary in their ecosystems, not free-form. Exported so S3's selector
// reuses the exact same architectural-signal vocabulary the gate uses
// (ADR-0035) — one primitive, never a second copy. gate.ts's only runtime
// import is governedTouches; its report/write import is type-only, so a check
// module importing these introduces no runtime cycle.
export const DEPENDENCY_MANIFESTS = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "deno.lock",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

// Path SEGMENT match (a directory name), never a substring — `src/schemaless/`
// must not signal.
const STORAGE_SEGMENTS = new Set(["schema", "schemas", "migration", "migrations"]);
const SCHEMA_BASENAME_RE = /^schema\.[a-z0-9]+$/i;

export function basenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

export function isStorageSchemaFile(path: string): boolean {
  const base = basenameOf(path);
  if (/\.sql$/i.test(base)) return true;
  const directorySegments = path.split("/").slice(0, -1);
  if (directorySegments.some((segment) => STORAGE_SEGMENTS.has(segment))) return true;
  return SCHEMA_BASENAME_RE.test(base);
}

/**
 * Deterministic Tier 1 relevance (ADR-0003): governed-path touches via the
 * same shared matcher D5 uses (no ACK exemption, no ADR-self-modification
 * exemption — a PR touching a governed path AND its ADR is exactly a PR
 * Tier 1 should read), changed dependency manifests by exact basename, and
 * storage artifacts by extension, path segment, or `schema.*` basename.
 * Consulted only when a PR context is present.
 */
export function relevanceGate(ctx: AdrLogContext): GateResult {
  if (!ctx.prContext) {
    throw new Error(
      "relevanceGate requires a PR context — the gate is PR-mode only (ADR-0003) and the caller decides applicability"
    );
  }
  const { changedFiles } = ctx.prContext;
  const signals: Tier1Signal[] = [];

  for (const adr of ctx.adrs) {
    if (adr.frontmatter.status !== "accepted") continue;
    const globs = adr.frontmatter.governs;
    if (!globs || globs.length === 0) continue;
    const files = governedTouches(changedFiles, globs);
    if (files.length > 0) signals.push({ kind: "governed-path", adr: adr.fileName, files });
  }

  const manifestFiles = changedFiles.filter((f) => DEPENDENCY_MANIFESTS.has(basenameOf(f)));
  if (manifestFiles.length > 0) signals.push({ kind: "dependency-manifest", files: manifestFiles });

  const storageFiles = changedFiles.filter(isStorageSchemaFile);
  if (storageFiles.length > 0) signals.push({ kind: "storage-schema", files: storageFiles });

  return { decision: signals.length > 0 ? "signal" : "no-signal", signals };
}

/**
 * Resolution order (deterministic, ADR-0029 / handoff Part 5):
 *   1. Not enabled → { enabled: false }.
 *   2. Enabled, credentials absent → "no-credentials". Signals are still
 *      computed when a PR context is present — the gate is free and its
 *      output is coverage truth.
 *   3. Enabled, credentials present, PR context present, gate says no-signal
 *      → "no-signal".
 *   4. Otherwise (signal in PR mode, or schedule/full-log mode where the gate
 *      does not apply) → "eligible".
 */
export function resolveTier1Status(
  config: Tier1Config,
  credentialsPresent: boolean,
  ctx: AdrLogContext
): Tier1Status {
  if (!config.enabled) return { enabled: false };
  const signals = ctx.prContext ? relevanceGate(ctx).signals : [];
  if (!credentialsPresent) return { enabled: true, status: "no-credentials", signals };
  if (ctx.prContext && signals.length === 0) return { enabled: true, status: "no-signal", signals };
  return { enabled: true, status: "eligible", signals };
}
