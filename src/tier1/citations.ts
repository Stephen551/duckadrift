import type { CheckInput, Tier1CheckId } from "./checks.js";

// Citation validation (ADR-0031): the parsed tool-call input is UNTRUSTED
// model output until this deterministic validator passes it. Every finding
// quotes its evidence verbatim from a supplied document, matched as bytes
// with only line-ending normalization, or the finding dies — and the death
// is counted and named, because a silently dropped finding and a silently
// dropped coverage gap are the same violation (PDR §2.4, the Pact).

/** Deliberately NOT the Tier 0 Finding — different trust class, different fields. Do not unify them. */
export interface Tier1Citation {
  /** Label of the document the quote comes from (must match a supplied document). */
  document: string;
  /** Verbatim quote — must byte-exist in that document's content. */
  quote: string;
}

export interface Tier1Finding {
  check: Tier1CheckId;
  claim: string;
  citations: Tier1Citation[]; // at least one after validation
  consequence: string;
  /** Model-reported confidence, 0–1. Carried verbatim; NEVER compared against any threshold in this codebase (PDR §2.6 — thresholds are calibration artifacts, M4). */
  reportedConfidence: number;
}

export type DiscardReason =
  | "no-citations"
  | "unknown-document"
  | "quote-not-found"
  | "malformed"
  | "insufficient-coverage";

/** Why a single citation was dropped from within a finding (a subset of the whole-finding reasons). */
export type CitationDropReason = "unknown-document" | "quote-not-found" | "malformed";

export interface CitationVerdict {
  accepted: Tier1Finding[];
  /** Every discard is counted and named — never silently dropped. */
  discarded: Array<{ check: Tier1CheckId; claim: string; reason: DiscardReason }>;
  /** Citations dropped from within findings that otherwise survived — the
   * fabricated-beside-the-real case (ADR-0033). Named, never silent. */
  droppedCitations: Array<{ check: Tier1CheckId; claim: string; reason: CitationDropReason }>;
}

/** Exactly ONE normalization on both sides of the byte-match: CRLF→LF. No trimming, no case folding, no whitespace collapse — the model quotes bytes or the citation dies. */
function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

/** A quote of the entire document is not evidence selection. */
const MAX_QUOTE_LENGTH = 2000;

function bestEffortClaim(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const claim = (value as Record<string, unknown>).claim;
    if (typeof claim === "string" && claim !== "") return claim;
  }
  return "(unparseable finding)";
}

/**
 * Validates the tool-call input from an untrusted model response. Parses
 * defensively: schema-shapes everything, discards non-conforming entries with
 * the closest reason, and never throws over a malformed response — the run
 * reports what it could validate and counts the rest.
 */
export function validateCitations(
  raw: unknown,
  input: CheckInput,
  check: Tier1CheckId,
  minDistinctCitedDocuments: number
): CitationVerdict {
  const accepted: Tier1Finding[] = [];
  const discarded: CitationVerdict["discarded"] = [];
  const droppedCitations: CitationVerdict["droppedCitations"] = [];

  const documentsByLabel = new Map<string, string>();
  for (const doc of input.documents) {
    // A duplicate label would let a later document silently overwrite an
    // earlier one, so a quote could "match" a document the finding did not
    // mean (S1-13). This cannot happen on the real path — production labels
    // are unique relative paths — so a duplicate is duckadrift's OWN
    // invariant violation, not model output: throw, don't degrade (ADR-0033
    // hardening; a throw here is unreachable by any model or file).
    if (documentsByLabel.has(doc.label)) {
      throw new Error(
        `validateCitations: duplicate document label ${JSON.stringify(doc.label)} in check input — labels must be unique (duckadrift invariant, not model output)`
      );
    }
    documentsByLabel.set(doc.label, normalizeLineEndings(doc.content));
  }

  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as Record<string, unknown>).findings)) {
    // Prose (or anything else) where the findings array should be. One loud
    // discard so the shape failure is visible in the report, not absorbed.
    discarded.push({ check, claim: "(unparseable response)", reason: "malformed" });
    return { accepted, discarded, droppedCitations };
  }

  for (const entry of (raw as { findings: unknown[] }).findings) {
    if (typeof entry !== "object" || entry === null) {
      discarded.push({ check, claim: bestEffortClaim(entry), reason: "malformed" });
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const claim = candidate.claim;
    const consequence = candidate.consequence;
    const confidence = candidate.reportedConfidence;

    if (typeof claim !== "string" || claim === "" || typeof consequence !== "string" || consequence === "") {
      discarded.push({ check, claim: bestEffortClaim(candidate), reason: "malformed" });
      continue;
    }
    // Clamping is FORBIDDEN: a confidence outside [0,1] is a non-conforming
    // response, and rewriting it would fabricate a number the model never
    // reported (PDR §2.6 — the number feeds calibration; it must be verbatim).
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      discarded.push({ check, claim, reason: "malformed" });
      continue;
    }

    const rawCitations = candidate.citations;
    if (!Array.isArray(rawCitations) || rawCitations.length === 0) {
      discarded.push({ check, claim, reason: "no-citations" });
      continue;
    }

    const surviving: Tier1Citation[] = [];
    const seen = new Set<string>();
    let firstFailure: DiscardReason | null = null;

    // A single citation can fail in one of these ways; when it does, count it
    // at the citation level (S1-12) IN ADDITION to recording firstFailure for
    // the whole-finding fallback — a fabricated citation that vanishes beside
    // a real one is the same silent drop the Pact forbids, one level down.
    const dropCitation = (reason: CitationDropReason): void => {
      if (firstFailure === null) firstFailure = reason;
      droppedCitations.push({ check, claim, reason });
    };

    for (const rawCitation of rawCitations) {
      if (typeof rawCitation !== "object" || rawCitation === null) {
        dropCitation("malformed");
        continue;
      }
      const citation = rawCitation as Record<string, unknown>;
      const document = citation.document;
      const quote = citation.quote;
      if (typeof document !== "string" || typeof quote !== "string") {
        dropCitation("malformed");
        continue;
      }
      if (quote === "" || quote.length > MAX_QUOTE_LENGTH) {
        dropCitation("quote-not-found");
        continue;
      }
      const content = documentsByLabel.get(document);
      if (content === undefined) {
        dropCitation("unknown-document");
        continue;
      }
      if (!content.includes(normalizeLineEndings(quote))) {
        dropCitation("quote-not-found");
        continue;
      }
      // Structural dedup key (S1-15): JSON.stringify of the (document, quote)
      // pair cannot collide across different pairs regardless of content. The
      // prior NUL-separated key was NOT collision-proof — a document body can
      // contain a NUL byte, so a quote can too, and the earlier comment
      // claiming otherwise was wrong. This keys on structure, not a magic
      // separator byte.
      const key = JSON.stringify([document, quote]);
      if (seen.has(key)) continue; // identical duplicate — keep one, deterministically
      seen.add(key);
      surviving.push({ document, quote });
    }

    if (surviving.length === 0) {
      discarded.push({ check, claim, reason: firstFailure ?? "no-citations" });
      continue;
    }

    // Structural coverage (ADR-0033): a finding must cite at least the check's
    // declared minimum of DISTINCT documents — a contradiction names both
    // records, a recurrence at least three. This is coverage (countable), not
    // relevance (an uncalibrated threshold, forbidden before M4). A finding
    // whose surviving citations span too few documents is discarded, counted
    // like every other discard.
    const distinctDocuments = new Set(surviving.map((c) => c.document)).size;
    if (distinctDocuments < minDistinctCitedDocuments) {
      discarded.push({ check, claim, reason: "insufficient-coverage" });
      continue;
    }

    accepted.push({ check, claim, citations: surviving, consequence, reportedConfidence: confidence });
  }

  return { accepted, discarded, droppedCitations };
}
