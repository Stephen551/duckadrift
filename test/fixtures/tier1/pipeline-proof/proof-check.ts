import { relative } from "node:path";
import type { AdrLogContext } from "../../../../src/adr/types.js";
import type { CheckDefinition } from "../../../../src/tier1/checks.js";

// The TEST-ONLY check that proves the pipeline (M3.2). It lives here, in the
// fixture, and is imported by tests — it is NOT in the production registry
// (src/tier1/checks.ts, TIER1_CHECKS), which ships empty until M3.3. Its id
// reuses "S1" because the Tier1CheckId union is closed by design; nothing
// about its instructions is the real S1.

export const PROOF_CHECK: CheckDefinition = {
  id: "S1",
  title: "Pipeline proof (test-only)",
  instructions: [
    "This is the pipeline-proof check. Read every supplied ADR document and report, as findings,",
    "any pair of decisions that could not both be followed by the same codebase at the same time,",
    "and any decision whose stated consequence contradicts its own decision text. Follow the",
    "citation contract exactly: every finding quotes its evidence verbatim from the supplied",
    "documents, with the document's exact label. If the documents are mutually consistent, report",
    "an empty findings array — an empty report is a correct report. Do not report Tier 0 material",
    "(numbering, formatting, dead links); this check reads meaning, not structure.",
  ].join("\n"),
  selectInput(ctx: AdrLogContext) {
    if (ctx.adrs.length === 0) return { skip: "no-input" as const };
    return {
      documents: ctx.adrs.map((adr) => ({
        label: adr.fileName,
        path: relative(ctx.repoRoot, adr.filePath).split("\\").join("/"),
        content: adr.raw,
      })),
    };
  },
};
