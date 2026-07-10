import type { CheckDefinition } from "../checks.js";
import { selectAcceptedFullLog } from "../checks.js";

// S1 — inter-ADR contradiction (PDR §2.4): Accepted records asserting
// decisions a single codebase could not follow at the same time. Semantic,
// not grep — the pipeline is ADR-0031's; this is a data record.

export const s1Contradiction: CheckDefinition = {
  id: "S1",
  title: "Inter-ADR contradiction — decisions a codebase cannot follow together",
  instructions: [
    "Detect contradiction between Accepted decision records: pairs whose decisions could not both",
    "be followed by the same codebase at the same time. The test is semantic incompatibility of",
    "what the decisions require, never keyword overlap — two records can contradict while sharing",
    "almost no vocabulary, and two records can share every key noun while being perfectly",
    "compatible. A record that narrows, refines, or extends another is not a contradiction.",
    "Records whose subjects are disjoint — one governs logging, the other storage — are not a",
    "contradiction merely for coexisting.",
    "",
    "Only Accepted records are inside this check's jurisdiction. A record marked Superseded,",
    "Rejected, or Deprecated is history, and disagreeing with history is how decisions work;",
    "report nothing about such records even when their text conflicts with a live decision.",
    "",
    "Each finding's claim must state what the incompatibility is — what one decision requires",
    "that the other forbids. Cite at least one verbatim quote from EACH member of the pair, so",
    "the reader can verify both halves in one click. If the log is consistent, the empty findings",
    "array is the correct report.",
  ].join("\n"),
  selectInput: (ctx) => selectAcceptedFullLog(ctx),
};
