import { ADR_FILENAME_RE } from "../../adr/parse.js";
import type { ParsedAdr } from "../../adr/types.js";
import type { Tier1Finding } from "../citations.js";
import type { Severity } from "./schema.js";

// A finding's severity is the consequence axis of the channel doctrine (§2.5).
// It is NOT on Tier1Finding — severity lives in ADR frontmatter (PDR §2.2,
// default routine). This derives it deterministically, and the §2.5 inversion
// (critical LOWERS the interrupt bar) is why the rule is a MAX, never an
// average: if any decision a finding implicates is critical, the finding's
// consequence is critical, and it must not be diluted by a routine co-citation.

const RANK: Record<Severity, number> = { critical: 3, elevated: 2, routine: 1, cosmetic: 0 };
const VALID_SEVERITIES = new Set<Severity>(["critical", "elevated", "routine", "cosmetic"]);

/** A citation's document is ADR-shaped iff its basename matches the ADR filename grammar — S2 source files and S3 manifests are not ADRs and contribute nothing. */
function isAdrDocument(document: string): boolean {
  const base = document.split("/").pop() ?? document;
  return ADR_FILENAME_RE.test(base);
}

/** An ADR's declared severity, defaulting to routine (the §2.2 default) when absent or unrecognized. */
function adrSeverity(adr: ParsedAdr): Severity {
  const raw = adr.frontmatter.severity;
  if (typeof raw === "string" && VALID_SEVERITIES.has(raw as Severity)) return raw as Severity;
  return "routine";
}

/**
 * The MAXIMUM severity among the ADRs a finding's citations name (critical >
 * elevated > routine > cosmetic). An ADR with no `severity:` is routine; a
 * finding citing NO ADR at all (possible for S3, which cites manifests/source)
 * is routine by the same default. Non-ADR citations contribute nothing.
 */
export function deriveFindingSeverity(
  finding: Tier1Finding,
  adrsByFileName: Map<string, ParsedAdr>
): Severity {
  let best: Severity = "routine"; // the default when no ADR is cited
  let sawAdr = false;
  for (const citation of finding.citations) {
    if (!isAdrDocument(citation.document)) continue;
    const adr = adrsByFileName.get(citation.document);
    if (adr === undefined) continue; // cites an ADR-shaped name not in this log — no severity to read
    const sev = adrSeverity(adr);
    if (!sawAdr || RANK[sev] > RANK[best]) {
      best = sev;
      sawAdr = true;
    }
  }
  return best;
}
