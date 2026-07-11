import type { ParsedAdr } from "./types.js";

// One status recognizer for every dialect (ADR-0040). A decision's declared
// state is read the same way everywhere: frontmatter, then a `## Status` heading
// section (Nygard's own canonical form), then the bold-line dialect the semantic
// selector previously matched alone. The FIRST form a record declares wins — a
// later dialect never overrides an earlier one. Before this, heading-dialect
// records were invisible to every status-gated behavior, and the selector had
// grown a second recognizer the parser did not share; two recognizers
// disagreeing about the same fact is the drift this tool exists to catch.

export type EffectiveStatusSource = "frontmatter" | "heading" | "bold-line" | "none";

export interface EffectiveStatus {
  /** The declared status, lowercased and reduced to its first token (or null when none is declared). */
  value: string | null;
  /** Which dialect the value was read from — named so a caller can explain its own decision. */
  source: EffectiveStatusSource;
}

// The bold-line dialect: `**Status:** <value>` as a standalone title-block line
// (the form the S4 specimen fixture uses). Generalized from the old select.ts
// regex to CAPTURE the status word rather than test only for "Accepted".
const BOLD_LINE_RE = /^\s*[-*]?\s*\*\*status:?\*\*\s*(.+)$/im;

// A repeated `Status:` / `**Status:**` label a heading-section body might carry
// before its actual value (`## Status` → `**Status:** Accepted`).
const LABEL_PREFIX_RE = /^\*{0,2}\s*status\s*:?\s*\*{0,2}\s*/i;

/**
 * Reduces a raw status expression — a heading-section body or a bold-line
 * capture — to its declared status token. Takes the first non-empty line, drops
 * a repeated Status label, strips leading decoration (cloud-platform's `✅
 * Accepted`), and returns the first whitespace-delimited token lowercased, so
 * `Accepted`, `✅ Accepted`, and `Accepted — 2026-07-11` all yield `accepted`
 * while a full sentence yields its first token (conservative; D1 still surfaces
 * a sloppy section softly).
 */
function normalizeStatusValue(raw: string): string | null {
  const firstLine = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  const unlabeled = firstLine.replace(LABEL_PREFIX_RE, "");
  const undecorated = unlabeled.replace(/^[^\p{L}\p{N}]+/u, "");
  const token = undecorated.trim().split(/\s+/)[0] ?? "";
  return token === "" ? null : token.toLowerCase();
}

/**
 * The single answer to "what status does this record declare," with its source
 * named. Resolution is declared-first: frontmatter, then the `## Status` heading
 * section (any heading level 1–3, case-insensitive), then the bold-line dialect.
 * A later dialect never overrides an earlier one.
 */
export function effectiveStatus(adr: ParsedAdr): EffectiveStatus {
  // 1. Frontmatter — already trimmed and lowercased by parse.ts. Declared wins,
  // even when the value is not "accepted": a heading must not override it.
  if (adr.frontmatter.status !== undefined) {
    const value = typeof adr.frontmatter.status === "string" ? adr.frontmatter.status : null;
    return { value, source: "frontmatter" };
  }

  // 2. `## Status` heading section — the canonical ADR form the parser already
  // structured; read the section body, not a fresh scan of the raw text.
  const statusSection = adr.sections.find(
    (s) => s.level >= 1 && s.level <= 3 && s.heading.trim().toLowerCase() === "status"
  );
  if (statusSection !== undefined) {
    const value = normalizeStatusValue(statusSection.body);
    if (value !== null) return { value, source: "heading" };
  }

  // 3. Bold-line dialect — the standalone `**Status:** …` title-block line.
  const boldMatch = BOLD_LINE_RE.exec(adr.raw);
  if (boldMatch !== null) {
    const value = normalizeStatusValue(boldMatch[1]!);
    if (value !== null) return { value, source: "bold-line" };
  }

  return { value: null, source: "none" };
}

/** True iff the record's effective status is exactly "accepted", in whatever dialect it declared it. */
export function isAccepted(adr: ParsedAdr): boolean {
  return effectiveStatus(adr).value === "accepted";
}
