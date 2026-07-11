import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { governedTouches } from "../adr/governs.js";
import { ADR_FILENAME_RE } from "../adr/parse.js";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
import type { CheckInput } from "./checks.js";
import { DEPENDENCY_MANIFESTS, basenameOf, isStorageSchemaFile } from "./gate.js";

// Input selection primitives (ADR-0032), in their own module so the import
// graph stays acyclic at runtime: checks.ts imports the check modules for the
// registry, and the check modules import the shared selector from HERE —
// never back from checks.ts. (The prior cycle worked only when entry began at
// the registry, by function hoisting; direct entry through a check module
// crashed the built ESM with a TDZ ReferenceError — verifier-reproduced.)
// The type-only CheckInput import above is erased at compile time and cannot
// re-create the cycle.

/**
 * A selector's verdict (ADR-0032): input, or a NAMED skip. "no-input" means
 * nothing to read in this mode; "input-exceeds-cap" means too much to read in
 * one call — different facts, reported distinctly, never conflated and never
 * silently trimmed. One shape, used by every check.
 */
export type SelectResult =
  | CheckInput
  | { skip: "no-input" }
  | { skip: "input-exceeds-cap"; bytes: number };

export function isSkip(result: SelectResult): result is Exclude<SelectResult, CheckInput> {
  return "skip" in result;
}

/** Provisional single-call input bound for full-log checks (ADR-0032). ~150K
 * tokens at 4 bytes/token, leaving prefix + response headroom. Measured
 * properly at M4; the successor (batched selection) is named in the ADR. */
export const TIER1_INPUT_CAP_BYTES = 600_000;

// Loose-dialect status (ADR-0004/0006): a real log records status as a bold
// title-block line with no frontmatter at all — the S4 specimen fixture is
// exactly this shape. A full-log check that read only frontmatter.status
// would silently skip the flagship corpus. Explicit non-accepted statuses
// (superseded, rejected, ...) stay excluded in either dialect.
const LOOSE_ACCEPTED_RE = /^\s*[-*]?\s*\*\*Status:?\*\*\s*Accepted\b/im;

export function isAcceptedAdr(adr: ParsedAdr): boolean {
  if (adr.frontmatter.status !== undefined) return adr.frontmatter.status === "accepted";
  return LOOSE_ACCEPTED_RE.test(adr.raw);
}

/**
 * The one full-log selector (shared by S4 and S1 — one primitive, not two
 * copies). PR mode: full-log recurrence/contradiction analysis earns PR-time
 * money exactly when the PR adds or edits ADRs, so input is selected only
 * when the diff touches a file under the ADR directory; any other PR is a
 * loud no-input skip. Full-log mode (no PR context): always select. Either
 * way the ADR-0032 cap applies: over it, skip aloud with the measured size.
 */
export function selectAcceptedFullLog(ctx: AdrLogContext): SelectResult {
  if (ctx.prContext) {
    const adrDirPrefix = `${relative(ctx.repoRoot, ctx.adrDir).split("\\").join("/")}/`;
    const touchesAdrDir = ctx.prContext.changedFiles.some((f) => f.startsWith(adrDirPrefix));
    if (!touchesAdrDir) return { skip: "no-input" };
  }

  const accepted = ctx.adrs.filter(isAcceptedAdr);
  if (accepted.length === 0) return { skip: "no-input" };

  const documents = accepted.map((adr) => ({
    label: adr.fileName,
    path: relative(ctx.repoRoot, adr.filePath).split("\\").join("/"),
    content: adr.raw,
  }));

  const bytes = documents.reduce((sum, doc) => sum + Buffer.byteLength(doc.content, "utf-8"), 0);
  if (bytes > TIER1_INPUT_CAP_BYTES) return { skip: "input-exceeds-cap", bytes };

  return { documents };
}

type SelectDocument = CheckInput["documents"][number];

/** Applies the ADR-0032 cap to a document set and returns the input or the loud skip. */
function capOrInput(documents: SelectDocument[]): SelectResult {
  if (documents.length === 0) return { skip: "no-input" };
  const bytes = documents.reduce((sum, doc) => sum + Buffer.byteLength(doc.content, "utf-8"), 0);
  if (bytes > TIER1_INPUT_CAP_BYTES) return { skip: "input-exceeds-cap", bytes };
  return { documents };
}

/** Reads a repo-relative file's content at HEAD (the working tree). Undefined for a deletion — a file listed in the diff but absent on disk (ADR-0035); not an error. */
function readAtHead(repoRoot: string, file: string): string | undefined {
  try {
    return readFileSync(join(repoRoot, file), "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * S2 selector (ADR-0035): PR-mode only. For each Accepted ADR carrying
 * `governs:` globs, the changed files it governs are read at HEAD — the
 * violation lives in the resulting STATE, and file content matches the
 * citation validator's byte-verbatim contract where a diff hunk's markers
 * would not. Documents are the governed ADR bodies plus the changed governed
 * files. No governed ADR touched → loud no-input skip (the diff IS the input).
 */
export function selectGovernedChangedFiles(ctx: AdrLogContext): SelectResult {
  if (!ctx.prContext) return { skip: "no-input" };
  const { changedFiles } = ctx.prContext;

  const governedAdrs: ParsedAdr[] = [];
  const touchedFiles = new Set<string>();
  for (const adr of ctx.adrs) {
    if (!isAcceptedAdr(adr)) continue;
    const globs = adr.frontmatter.governs;
    if (!globs || globs.length === 0) continue;
    const files = governedTouches(changedFiles, globs);
    if (files.length === 0) continue;
    governedAdrs.push(adr);
    for (const f of files) touchedFiles.add(f);
  }
  if (governedAdrs.length === 0) return { skip: "no-input" };

  const documents: SelectDocument[] = governedAdrs.map((adr) => ({
    label: adr.fileName,
    path: relative(ctx.repoRoot, adr.filePath).split("\\").join("/"),
    content: adr.raw,
  }));
  for (const file of [...touchedFiles].sort()) {
    const content = readAtHead(ctx.repoRoot, file);
    if (content === undefined) continue; // a deletion — no content to inspect
    documents.push({ label: file, path: file, content });
  }
  return capOrInput(documents);
}

/** True when a changed path is an ADR file: under the ADR directory AND ADR-filename-shaped (README.md and other companions are not). */
function touchesAdrRecord(ctx: AdrLogContext, changedFiles: string[]): boolean {
  const adrDirPrefix = `${relative(ctx.repoRoot, ctx.adrDir).split("\\").join("/")}/`;
  return changedFiles.some((f) => f.startsWith(adrDirPrefix) && ADR_FILENAME_RE.test(basenameOf(f)));
}

/**
 * S3 selector (ADR-0035): PR-mode only. S3 hunts the UNRECORDED decision, so
 * a diff that touched a decision record is not its case — it stands down with
 * a no-input skip (the fixture's control contract). Otherwise it collects the
 * architectural-signal files using the SAME predicates the gate uses (imported,
 * not copied) and reads each at HEAD. No signals → loud no-input skip.
 */
export function selectUnrecordedSignals(ctx: AdrLogContext): SelectResult {
  if (!ctx.prContext) return { skip: "no-input" };
  const { changedFiles } = ctx.prContext;
  if (touchesAdrRecord(ctx, changedFiles)) return { skip: "no-input" };

  const signalFiles = changedFiles.filter(
    (f) => DEPENDENCY_MANIFESTS.has(basenameOf(f)) || isStorageSchemaFile(f)
  );
  if (signalFiles.length === 0) return { skip: "no-input" };

  const documents: SelectDocument[] = [];
  for (const file of signalFiles) {
    const content = readAtHead(ctx.repoRoot, file);
    if (content === undefined) continue;
    documents.push({ label: file, path: file, content });
  }
  return capOrInput(documents);
}

/**
 * S5 selector (ADR-0035): a whole-log check — decay is not a per-diff
 * question, so it runs in either mode. Every Accepted ADR body is the input;
 * the model surfaces premises the ADR text asserts as live, and the evidence
 * is the ADR's own words. S5 does NOT read the tree — a deterministic
 * existence check would be a Tier-0-style claim, out of scope for the
 * uncalibrated tier.
 */
export function selectDecaySweep(ctx: AdrLogContext): SelectResult {
  const documents: SelectDocument[] = ctx.adrs.filter(isAcceptedAdr).map((adr) => ({
    label: adr.fileName,
    path: relative(ctx.repoRoot, adr.filePath).split("\\").join("/"),
    content: adr.raw,
  }));
  return capOrInput(documents);
}
