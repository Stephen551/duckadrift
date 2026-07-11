import type { CheckDefinition } from "../checks.js";
import { selectUnrecordedSignals } from "../select.js";

// S3 — unrecorded decision (PDR §2.4): an architectural-looking change in a
// diff that touched no decision record. A data record on the ADR-0031
// pipeline; the selector collects the architectural-signal files (ADR-0035),
// standing down when a decision record was touched.

export const s3UnrecordedDecision: CheckDefinition = {
  id: "S3",
  title: "Unrecorded decision — an architectural change with no decision record",
  instructions: [
    "You are given one or more changed files from a pull request that touched NO decision record.",
    "Each file carries an architectural signal — a new or changed dependency manifest, or a new",
    "storage or schema artifact. Each file's content is its CURRENT STATE at HEAD, not a diff.",
    "Report each change that embodies an architectural decision which should have been recorded but",
    "was not: adopting a dependency that shapes the system, introducing a storage schema, choosing a",
    "persistence or boundary that a later reader would need the reasoning for.",
    "",
    "A routine, non-architectural change is not a finding: a version bump within a pinned range, a",
    "lockfile churn with no new direct dependency, a formatting-only edit. The bar is: would a",
    "maintainer six months from now need a recorded decision to understand why this is here.",
    "",
    "Each finding names the file and quotes verbatim the specific content that constitutes the",
    "unrecorded decision — the added dependency line, the schema definition. If nothing in the",
    "changed files rises to an architectural decision, the empty findings array is the correct report.",
  ].join("\n"),
  selectInput: (ctx) => selectUnrecordedSignals(ctx),
  // One unrecorded decision is citable in one file (ADR-0033).
  minDistinctCitedDocuments: 1,
};
