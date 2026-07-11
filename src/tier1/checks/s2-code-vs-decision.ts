import type { CheckDefinition } from "../checks.js";
import { selectGovernedChangedFiles } from "../select.js";

// S2 — code-vs-decision drift (PDR §2.4): a changed file's current state
// violating the substance of an Accepted decision that governs it. A data
// record on the ADR-0031 pipeline; the shared selector reads governed changed
// files at HEAD (ADR-0035 — state, not a diff hunk).

export const s2CodeVsDecision: CheckDefinition = {
  id: "S2",
  title: "Code-vs-decision drift — a governed file violating its governing decision",
  instructions: [
    "You are given one or more Accepted decision records and one or more changed source files that",
    "those records govern. Each file's content is its CURRENT STATE at HEAD — the working-tree",
    "content, not a diff and not a set of changes. Report where a changed file's current content",
    "violates the substance of a decision that governs it: the decision requires, forbids, or",
    "constrains something, and the file's state does the opposite or omits it.",
    "",
    "Judge substance, not surface. A file that honors a decision by a different but equivalent means",
    "is not a violation. A decision that merely mentions a file is not governance. The violation must",
    "be a concrete conflict between what a governing record requires and what the file's state is.",
    "",
    "Each finding must cite BOTH sides in one click: a verbatim quote of the governing decision from",
    "its record, AND a verbatim quote of the offending content from the changed file. Name the record",
    "and the file. If the governed files honor every governing decision, the empty findings array is",
    "the correct report.",
  ].join("\n"),
  selectInput: (ctx) => selectGovernedChangedFiles(ctx),
  // A drift finding is a relationship between a decision and a file: it must
  // cite both records (ADR-0033 structural coverage).
  minDistinctCitedDocuments: 2,
};
