import type { CheckDefinition } from "../checks.js";
import { selectDecaySweep } from "../select.js";

// S5 — decay sweep (PDR §2.4), two-stage (ADR-0036). STAGE 1 (this
// instruction, recorded): the model EXTRACTS the concrete externals an
// Accepted record treats as live premises — a named dependency or a
// file/module path — quoting each verbatim. It does NOT judge deadness. STAGE
// 2 (src/tier1/confirm-premise.ts, deterministic, runs in replay and live
// alike): a concretely-named referent provably absent from the repository is
// dead decay; a present referent, or a premise naming nothing concrete, is
// dropped and counted. The discriminator, not a sterilized fixture, keeps the
// negative control clean.

export const s5Decay: CheckDefinition = {
  id: "S5",
  title: "Decay sweep — Accepted records whose concrete premises may have decayed",
  instructions: [
    "You are given Accepted decision records. For each record, report every place its Context or",
    "Decision treats a CONCRETE EXTERNAL as a live, currently-present premise. Concrete means one of",
    "exactly two things: a NAMED SOFTWARE DEPENDENCY (a package name, e.g. one the record describes as",
    "pinned in a manifest or installed) or a FILE OR MODULE PATH in the repository (e.g.",
    "src/pipeline/color.ts). Nothing else counts as concrete for this check: a URL, a hosted service,",
    "a tool or capability named without a package, or a configuration that names no package and no",
    "path is NOT a concrete premise and must not be reported.",
    "",
    "Quote the premise VERBATIM from the record — the citation must carry the exact text that names",
    "the dependency or the path, byte-for-byte. Do not paraphrase the name. A finding names the",
    "concrete referent in its claim and quotes it; the disposition is: confirm this premise still",
    "resolves.",
    "",
    "You are NOT asked whether the premise still holds — you cannot see the repository tree, and a",
    "downstream deterministic step confirms deadness by checking whether the named dependency or path",
    "still exists. Your job is extraction only: name and quote the concrete externals a record leans",
    "on. Be conservative — a record that reasons in the abstract, naming no package and no path it",
    "treats as present, is not a finding. If no record names a concrete dependency or path as a live",
    "premise, the empty findings array is the correct report.",
  ].join("\n"),
  selectInput: (ctx) => selectDecaySweep(ctx),
  // A decayed premise lives in one record (ADR-0033).
  minDistinctCitedDocuments: 1,
};
