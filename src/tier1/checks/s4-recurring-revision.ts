import type { CheckDefinition } from "../checks.js";
import { selectAcceptedFullLog } from "../checks.js";

// S4 — recurring revision (PDR §2.4): the flagship demo. Hunts N≥3 Accepted
// ADRs revising the same underlying decision without resolving it — the
// 0040–0043 specimen. The check is a data record; the pipeline is ADR-0031's.

export const s4RecurringRevision: CheckDefinition = {
  id: "S4",
  title: "Recurring revision — one unresolved decision revised across many records",
  instructions: [
    "Detect recurring revision: sets of three or more Accepted decision records that revise,",
    "refine, park, or re-attempt the same underlying decision without any of them resolving it.",
    "The records' surface topics may differ — one may adjust a mechanism, another a prerequisite,",
    "another a different component entirely — and a shared vocabulary across titles is neither",
    "necessary nor sufficient. Read through the surfaces to the shared unresolved primitive: the",
    "single question or discrimination that every record in the set circles, defers, or parks.",
    "",
    "A set qualifies only when: (1) it contains at least three records; (2) each record engages",
    "the same underlying decision, whether by explicit reference to earlier members or by",
    "substance; and (3) no record in the set resolves that decision — each one parks it, banks a",
    "partial result, defers it to future work, or narrows it without closing it. A chain of",
    "records that ENDS in a resolution is healthy iteration, not recurring revision, and must not",
    "be reported.",
    "",
    "Each finding's claim must name the shared unresolved primitive in plain language and state",
    "the revision count — how many records in the set. Cite at least one verbatim quote from EACH",
    "record in the set, so the reader can verify every member's participation in one click. If",
    "every decision in the log stands resolved or the records are unrelated, the empty findings",
    "array is the correct report.",
  ].join("\n"),
  selectInput: (ctx) => selectAcceptedFullLog(ctx),
};
