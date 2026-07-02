import type { AdrSection, Dialect } from "./types.js";

const MADR_MARKERS = ["decision outcome", "decision drivers", "considered options"];
const NYGARD_MARKERS = ["status", "context", "decision", "consequences"];

/**
 * Detects Nygard vs MADR from section headings (PDR §2.2). Falls back to
 * "unknown" rather than guessing — D1's missing-section rule only applies
 * to dialects it can confidently identify, to keep Tier 0's zero-false-
 * positive contract (§2.3) intact for ADRs that don't cleanly fit either.
 */
export function detectDialect(sections: AdrSection[]): Dialect {
  const headings = sections.map((s) => s.heading.toLowerCase().trim());
  if (headings.some((h) => MADR_MARKERS.some((marker) => h.includes(marker)))) {
    return "madr";
  }
  const nygardHits = NYGARD_MARKERS.filter((marker) => headings.includes(marker)).length;
  if (nygardHits >= 2) {
    return "nygard";
  }
  return "unknown";
}

export const REQUIRED_SECTIONS: Record<Dialect, readonly string[]> = {
  nygard: ["context", "decision"],
  madr: ["context and problem statement", "decision outcome"],
  unknown: [],
};
