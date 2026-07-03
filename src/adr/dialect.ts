import type { AdrSection, Dialect } from "./types.js";

const MADR_MARKERS = ["decision outcome", "decision drivers", "considered options"];
const NYGARD_MARKERS = ["status", "context", "decision", "consequences"];

// A real-world pattern found running Gate G1 against an external repo: status
// carried as bold prose (`- **Status:** Accepted ...`) right under the title,
// no `## Status` heading, no YAML frontmatter. Structurally looser than
// Nygard/MADR — REQUIRED_SECTIONS asserts nothing for it (ADR-0004).
const BOLD_STATUS_RE = /^\s*[-*]?\s*\*\*Status:?\*\*/im;

/**
 * Detects Nygard / MADR / loose from section headings and title-block prose
 * (PDR §2.2). Falls back to "unknown" rather than guessing — D1's missing-
 * section rule only applies to dialects it can confidently identify, to keep
 * Tier 0's zero-false-positive contract (§2.3) intact for ADRs that don't
 * cleanly fit any of them.
 */
export function detectDialect(sections: AdrSection[]): Dialect {
  const headings = sections.map((s) => s.heading.toLowerCase().trim());

  if (headings.some((h) => MADR_MARKERS.some((marker) => h.includes(marker)))) {
    return "madr";
  }

  const titleSection = sections.find((s) => s.level === 1);
  if (titleSection && !headings.includes("status") && BOLD_STATUS_RE.test(titleSection.body)) {
    return "loose";
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
  loose: [],
  unknown: [],
};

// A required section is satisfied by any of its aliases — real ADR logs
// rename "Context" to "Problem" or "Problem Statement" without meaning
// anything different by it (ADR-0004).
export const SECTION_ALIASES: Record<string, readonly string[]> = {
  context: ["context", "problem", "problem statement"],
};

export function sectionSatisfied(required: string, presentHeadings: ReadonlySet<string>): boolean {
  const aliases = SECTION_ALIASES[required] ?? [required];
  return aliases.some((alias) => presentHeadings.has(alias));
}
