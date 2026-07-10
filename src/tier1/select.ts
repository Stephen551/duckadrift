import { relative } from "node:path";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
import type { CheckInput } from "./checks.js";

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
