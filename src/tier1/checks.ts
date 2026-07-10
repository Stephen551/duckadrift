import type { AdrLogContext } from "../adr/types.js";

// Checks as data (ADR-0031). There is exactly ONE pipeline — prompt builder,
// transport, validator, runner — and a check is a data record it consumes:
// instructions (part of the cached static prefix) plus a deterministic input
// selector. A second pipeline is the parallel-primitive failure this
// repository has already shipped once and now treats as a standing audit
// concern. Adding a check means writing a record and its recording, never
// touching the pipeline.

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
  /** Deterministic input selector. Returns null when the check has nothing to read in this mode (reported as skipped, never silent). */
  selectInput(ctx: AdrLogContext): CheckInput | null;
}

/** The production registry. EMPTY in M3.2 — S1–S5 register at M3.3. */
export const TIER1_CHECKS: readonly CheckDefinition[] = [];
