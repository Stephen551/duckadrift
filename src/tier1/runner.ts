import type { AdrLogContext } from "../adr/types.js";
import { loadConfig } from "../config/load.js";
import type { CheckDefinition, Tier1CheckId } from "./checks.js";
import { TIER1_INPUT_CAP_BYTES, isSkip } from "./select.js";
import { validateCitations } from "./citations.js";
import type { CitationVerdict, Tier1Finding } from "./citations.js";
import { buildRequest } from "./prompt.js";
import type { Tier1Transport } from "./transport.js";

// The one runner (ADR-0031). Sequential over the checks; per check:
// selectInput → build request → transport → validate citations → accumulate.
// The runner has no knowledge of channels: it returns findings, the report
// renders them in the annex, and there is nowhere else for them to go — no
// interrupt code path exists in this build, structurally (opening that
// channel is the 1.0 event, ADR-0012).

/** A skip is a NAMED fact (ADR-0032): nothing to read, or too much to read in one call — never conflated. */
export type Tier1Skip =
  | { check: Tier1CheckId; reason: "no-input" }
  | { check: Tier1CheckId; reason: "input-exceeds-cap"; bytes: number; cap: number };

export interface Tier1RunResult {
  findings: Tier1Finding[]; // accepted only
  discarded: CitationVerdict["discarded"];
  droppedCitations: CitationVerdict["droppedCitations"];
  skipped: Tier1Skip[];
  errors: Array<{ check: Tier1CheckId; message: string }>; // transport/parse failures, run continues
}

/**
 * Extraction result: the forced tool call's input, or a NAMED reason it could
 * not be taken. "none" — no report_findings block at all. "duplicate" — MORE
 * than one, a violation of the forced single-tool contract (S3-14): selecting
 * the first would silently lose the rest, so the runner refuses all of them.
 */
type Extracted =
  | { ok: true; input: unknown }
  | { ok: false; reason: "none" | "duplicate"; count: number };

function extractToolInput(response: unknown): Extracted {
  if (typeof response !== "object" || response === null) return { ok: false, reason: "none", count: 0 };
  const content = (response as Record<string, unknown>).content;
  if (!Array.isArray(content)) return { ok: false, reason: "none", count: 0 };
  const blocks = content.filter((block): block is Record<string, unknown> => {
    if (typeof block !== "object" || block === null) return false;
    const candidate = block as Record<string, unknown>;
    return candidate.type === "tool_use" && candidate.name === "report_findings";
  });
  if (blocks.length === 0) return { ok: false, reason: "none", count: 0 };
  // A response with two report_findings blocks violated the forced contract on
  // the wire; refuse all, never silently take the first (S3-14).
  if (blocks.length > 1) return { ok: false, reason: "duplicate", count: blocks.length };
  return { ok: true, input: blocks[0]!.input };
}

export async function runTier1Checks(
  ctx: AdrLogContext,
  checks: readonly CheckDefinition[],
  transport: Tier1Transport
): Promise<Tier1RunResult> {
  // Model and effort come from the repo's config — the same values that key
  // the recording (ADR-0028) and, at M4, the calibration entry (PDR §2.6).
  // Quiet load: any per-run config notices were already emitted by the
  // loadAdrLog that produced ctx.
  const { model, effort } = loadConfig(ctx.repoRoot, { quiet: true }).tier1;

  const result: Tier1RunResult = { findings: [], discarded: [], droppedCitations: [], skipped: [], errors: [] };

  for (const check of checks) {
    const selection = check.selectInput(ctx);
    if (isSkip(selection)) {
      // Loud, never silent (the Pact; ADR-0032): a check with nothing to read
      // is a reported skip, and a check with too much to read in one call is
      // a DIFFERENT reported skip carrying the measured size and the cap —
      // never a silent trim, never a partial read presented as a full one.
      result.skipped.push(
        selection.skip === "input-exceeds-cap"
          ? { check: check.id, reason: "input-exceeds-cap", bytes: selection.bytes, cap: TIER1_INPUT_CAP_BYTES }
          : { check: check.id, reason: "no-input" }
      );
      continue;
    }

    const request = buildRequest(check, selection, { model, effort });

    // The whole untrusted-response handling — transport, extract, validate —
    // is inside one try/catch: one check's failure never silently costs
    // another's coverage, AND the runner never propagates a throw from a
    // pathological response object (a throwing getter, a reference cycle —
    // none reach the real JSON wire, but the guarantee is "the runner never
    // propagates", not "the validator handles impossible inputs"; ADR-0033,
    // S3-16/S3-17). Any throw becomes a counted error and the run continues.
    try {
      const response = await transport.send(request);

      const extracted = extractToolInput(response);
      if (!extracted.ok) {
        result.errors.push({
          check: check.id,
          message:
            extracted.reason === "duplicate"
              ? `response carried ${extracted.count} report_findings tool calls; the forced contract is exactly one`
              : "response carries no report_findings tool call — nothing to validate",
        });
        continue;
      }

      const verdict = validateCitations(
        extracted.input,
        selection,
        check.id,
        check.minDistinctCitedDocuments
      );
      result.findings.push(...verdict.accepted);
      result.discarded.push(...verdict.discarded);
      result.droppedCitations.push(...verdict.droppedCitations);
    } catch (err) {
      result.errors.push({
        check: check.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
