import type { AdrLogContext } from "../adr/types.js";
import { loadConfig } from "../config/load.js";
import type { CheckDefinition, Tier1CheckId } from "./checks.js";
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

export interface Tier1RunResult {
  findings: Tier1Finding[]; // accepted only
  discarded: CitationVerdict["discarded"];
  skipped: Array<{ check: Tier1CheckId; reason: "no-input" }>;
  errors: Array<{ check: Tier1CheckId; message: string }>; // transport/parse failures, run continues
}

/** Defensive extraction of the forced tool call's input from an untrusted response body. Returns undefined when no report_findings tool call is present. */
function extractToolInput(response: unknown): unknown {
  if (typeof response !== "object" || response === null) return undefined;
  const content = (response as Record<string, unknown>).content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type === "tool_use" && candidate.name === "report_findings") {
      return candidate.input;
    }
  }
  return undefined;
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

  const result: Tier1RunResult = { findings: [], discarded: [], skipped: [], errors: [] };

  for (const check of checks) {
    const input = check.selectInput(ctx);
    if (input === null) {
      // Loud, never silent: a check with nothing to read in this mode is a
      // reported skip (the Pact — the watch may pause visibly).
      result.skipped.push({ check: check.id, reason: "no-input" });
      continue;
    }

    const request = buildRequest(check, input, { model, effort });

    let response: unknown;
    try {
      response = await transport.send(request);
    } catch (err) {
      // One check's failure never silently costs another's coverage: record
      // the error loudly and CONTINUE to the next check.
      result.errors.push({
        check: check.id,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const rawInput = extractToolInput(response);
    if (rawInput === undefined) {
      result.errors.push({
        check: check.id,
        message: "response carries no report_findings tool call — nothing to validate",
      });
      continue;
    }

    const verdict = validateCitations(rawInput, input, check.id);
    result.findings.push(...verdict.accepted);
    result.discarded.push(...verdict.discarded);
  }

  return result;
}
