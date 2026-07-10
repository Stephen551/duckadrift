import type { AdrLogContext } from "../adr/types.js";
import type { SelectResult } from "./select.js";
import { s1Contradiction } from "./checks/s1-contradiction.js";
import { s4RecurringRevision } from "./checks/s4-recurring-revision.js";

// Checks as data (ADR-0031). There is exactly ONE pipeline — prompt builder,
// transport, validator, runner — and a check is a data record it consumes:
// instructions (part of the cached static prefix) plus a deterministic input
// selector. Adding a check means writing a record and its recording, never
// touching the pipeline.
//
// Import discipline: this module imports the check modules (registry), and
// the check modules import the shared selection primitives from select.ts —
// NEVER from here. The SelectResult import above is type-only (erased); a
// value import back into a check module would re-create the runtime cycle
// the verifier caught crashing direct ESM entry.

export type Tier1CheckId = "S1" | "S2" | "S3" | "S4" | "S5";

/** What a check hands the model, selected deterministically before any call. */
export interface CheckInput {
  /** Delimited data blocks (the prompt envelope applies): ADR bodies, diff hunks, file excerpts. */
  documents: Array<{ label: string; path: string; content: string }>;
}

export interface CheckDefinition {
  id: Tier1CheckId;
  title: string;
  /** The check's instruction text — part of the STATIC prefix (cached). */
  instructions: string;
  /** Deterministic input selector (select.ts). Every skip is reported loudly, never silent. */
  selectInput(ctx: AdrLogContext): SelectResult;
}

/** The production registry. S4 and S1 live here as of M3.3a; S2/S3/S5 land at M3.3b. */
export const TIER1_CHECKS: readonly CheckDefinition[] = [s1Contradiction, s4RecurringRevision];
