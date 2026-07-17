import type { AdrSection, ParsedAdr } from "./types.js";

// One status recognizer for every dialect (ADR-0039). A decision's declared
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

// A fenced example is quoted text, not a declaration: a `## Status` heading or
// a `**Status:** ...` line inside a code fence documents a convention, it does
// not declare this record's state. Reading one as real falsely opened every
// status-gated check on records with no declared status at all (the PR #47
// verifier probes). Both recognizer paths below consult this ONE primitive; a
// second copy of fence logic anywhere is the parallel-recognizer drift this
// module exists to end.
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The record's raw text with every fenced code region blanked,
 * line-preserving: delimiter lines and fenced content become empty lines, so
 * line-oriented scans see only prose and every surviving line keeps its
 * original index. Backtick and tilde fences, closed by at least as long a run
 * of the same character (CommonMark), an unclosed fence running to end of
 * file. Indented (four-space) code blocks are out of scope here.
 */
function maskFencedRegions(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const masked: string[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    if (fence === null) {
      const open = FENCE_OPEN_RE.exec(line);
      if (open === null) {
        masked.push(line);
      } else {
        fence = { char: open[1]![0]!, len: open[1]!.length };
        masked.push("");
      }
      continue;
    }
    if (new RegExp(`^ {0,3}${fence.char}{${fence.len},}\\s*$`).test(line)) fence = null;
    masked.push("");
  }
  return masked.join("\n");
}

// The recognizer's own heading shape: the levels it accepts (1-3) and the
// parser's ATX form (`HEADING_RE` requires whitespace after the hashes, so
// `####` can never shrink to a match here).
const STATUS_HEADING_LINE_RE = /^(#{1,3})\s+(.*)$/;

function isStatusHeadingLine(line: string): boolean {
  const match = STATUS_HEADING_LINE_RE.exec(line);
  return match !== null && match[2]!.trim().toLowerCase() === "status";
}

/**
 * Picks the Status section whose heading line sits outside every fenced
 * region. The parser's sections are fence-blind and carry no offsets, so the
 * candidates are paired positionally against the status-heading lines found
 * in the raw text: same count means same document order, and the first
 * candidate whose line survives the fence mask is the real section. When the
 * counts disagree (a status-shaped line inside frontmatter or an HTML
 * comment is visible to one scan and not the other), pairing is unreliable
 * and the fallback is the conservative veto: the parser's first candidate
 * stands only if at least one status heading line survives the mask at all.
 */
function selectUnfencedStatusSection(
  raw: string,
  maskedRaw: string,
  candidates: AdrSection[]
): AdrSection | null {
  const rawLines = raw.split(/\r?\n/);
  const maskedLines = maskedRaw.split(/\r?\n/);
  const statusLineIndexes: number[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (isStatusHeadingLine(rawLines[i]!)) statusLineIndexes.push(i);
  }
  const unfenced = statusLineIndexes.filter((i) => isStatusHeadingLine(maskedLines[i] ?? ""));
  if (unfenced.length === 0) return null;
  if (statusLineIndexes.length !== candidates.length) return candidates[0] ?? null;
  for (let c = 0; c < candidates.length; c++) {
    if (isStatusHeadingLine(maskedLines[statusLineIndexes[c]!] ?? "")) return candidates[c]!;
  }
  return null;
}

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
  const rawToken = undecorated.trim().split(/\s+/)[0] ?? "";
  // The word-run still carries wrapping the wild puts around it: markdown
  // emphasis (edgex's `**Approved**`) and trailing punctuation (cosmos's
  // `Accepted.`). Strip both so the status token is the bare word. These
  // characters never occur inside a real status word, so the strip is lossless.
  const token = rawToken.replace(/[*_`]+/g, "").replace(/[.:;,]+$/, "");
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

  const maskedRaw = maskFencedRegions(adr.raw);

  // 2. `## Status` heading section — the canonical ADR form the parser already
  // structured; read the section body, not a fresh scan of the raw text. A
  // section is accepted only if its heading line sits outside every fenced
  // region: the parser is fence-blind, so a fenced example's `## Status`
  // arrives here as a real-looking section and must be screened out.
  const candidates = adr.sections.filter(
    (s) => s.level >= 1 && s.level <= 3 && s.heading.trim().toLowerCase() === "status"
  );
  if (candidates.length > 0) {
    const statusSection = selectUnfencedStatusSection(adr.raw, maskedRaw, candidates);
    if (statusSection !== null) {
      const value = normalizeStatusValue(statusSection.body);
      if (value !== null) return { value, source: "heading" };
    }
  }

  // 3. Bold-line dialect — the standalone `**Status:** …` title-block line,
  // scanned over the fence-masked raw so a fenced example never matches.
  const boldMatch = BOLD_LINE_RE.exec(maskedRaw);
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
