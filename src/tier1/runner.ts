import type { AdrLogContext } from "../adr/types.js";
import { loadConfig } from "../config/load.js";
import type { CheckDefinition, Tier1CheckId } from "./checks.js";
import { TIER1_INPUT_CAP_BYTES, isSkip } from "./select.js";
import { validateCitations } from "./citations.js";
import type { CitationVerdict, Tier1Finding } from "./citations.js";
import { confirmDeadPremise } from "./confirm-premise.js";
import { buildRequest } from "./prompt.js";
import type { SweepCheckpoint } from "./sweep.js";
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

/** Measured token usage for one check's call (ADR-0035, PDR §2.8 — measured, never estimated). Replay bodies carry the recorded usage; a body lacking a field reads 0. */
export interface Tier1CheckUsage {
  check: Tier1CheckId;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface Tier1RunResult {
  findings: Tier1Finding[]; // accepted only
  discarded: CitationVerdict["discarded"];
  droppedCitations: CitationVerdict["droppedCitations"];
  skipped: Tier1Skip[];
  errors: Array<{ check: Tier1CheckId; message: string }>; // transport/parse failures, run continues
  /** S5 findings dropped because the extracted premise is still live (ADR-0036) — counted, never silent. */
  livePremises: Array<{ check: "S5"; claim: string }>;
  /** One entry per check that made a call (live or replay); skipped checks contribute none. */
  usage: Tier1CheckUsage[];
  /** Present when quota exhaustion paused the sweep (ADR-0045): completed and total units, and the units NOT checked, enumerated by name, never summarized (PDR 2.8). */
  paused?: { completed: number; total: number; notChecked: Tier1CheckId[] };
}

export interface RunTier1Options {
  /** The sweep checkpoint (ADR-0045). Absent for gated PR-mode runs; present for sweeps that must pause visibly and resume exactly. */
  checkpoint?: SweepCheckpoint;
}

/** Reads the four usage fields off the seam's untrusted usage block, defensively: any absent field is 0 (a replay body may omit them). The block arrives already extracted by the transport (ADR-0044); the runner never learns an envelope shape. */
function readUsage(check: Tier1CheckId, usageBlock: unknown): Tier1CheckUsage {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const usage =
    typeof usageBlock === "object" && usageBlock !== null
      ? (usageBlock as Record<string, unknown>)
      : undefined;
  return {
    check,
    inputTokens: num(usage?.input_tokens),
    outputTokens: num(usage?.output_tokens),
    cacheReadTokens: num(usage?.cache_read_input_tokens),
    cacheCreationTokens: num(usage?.cache_creation_input_tokens),
  };
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
  transport: Tier1Transport,
  opts: RunTier1Options = {}
): Promise<Tier1RunResult> {
  void opts; // consumed by the ADR-0045 checkpoint integration (green commit)
  // Model and effort come from the repo's config — the same values that key
  // the recording (ADR-0028) and, at M4, the calibration entry (PDR §2.6).
  // Quiet load: any per-run config notices were already emitted by the
  // loadAdrLog that produced ctx.
  const { model, effort } = loadConfig(ctx.repoRoot, { quiet: true }).tier1;

  const result: Tier1RunResult = { findings: [], discarded: [], droppedCitations: [], skipped: [], errors: [], livePremises: [], usage: [] };

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
      const { response, usage } = await transport.send(request);

      // A call was made (live or replay) — its measured usage is recorded
      // whatever the response's shape, before any refusal or discard, so cost
      // is reported from observation (ADR-0035, PDR §2.8).
      result.usage.push(readUsage(check.id, usage));

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
      result.discarded.push(...verdict.discarded);
      result.droppedCitations.push(...verdict.droppedCitations);

      // S5 stage 2 (ADR-0036): a validated extraction is real decay only if
      // its named referent is provably absent. Confirmation is deterministic
      // and runs on the check's ctx (real repo/fixture root) — identical under
      // replay and live. Keyed on S5 alone; every other check's findings pass
      // through untouched.
      for (const finding of verdict.accepted) {
        if (check.id === "S5") {
          if (confirmDeadPremise(finding, ctx).dead) {
            result.findings.push(finding);
          } else {
            // Dropped because still-live — counted, never silent (the Pact).
            result.livePremises.push({ check: "S5", claim: finding.claim });
          }
        } else {
          result.findings.push(finding);
        }
      }
    } catch (err) {
      result.errors.push({
        check: check.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
