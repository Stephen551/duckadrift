import { parse as parseYaml } from "yaml";
import { detectDialect } from "./dialect.js";
import type { AdrFrontmatter, AdrLink, AdrSection, ParsedAdr } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

const WHITESPACE_RE = /\s/;

// Strip a recognizable trailing CommonMark title — whitespace then `"..."`,
// `'...'`, or `(...)` at the end — in LINEAR time. The obvious regex for this,
// `/\s+("[^"]*"|'[^']*'|\([^)]*\))\s*$/`, is O(n^2): on a long internal
// whitespace run followed by an unterminated title token, `\s+` re-consumes and
// backtracks the whole run from every start position — the catastrophic-
// backtracking class S6/ADR-0013 hardened, and a fork-PR resource-exhaustion
// vector since untrusted ADR content reaches this. Instead: find the last
// non-space char; if it closes a title (`"`, `'`, `)`), locate the matching
// opener with lastIndexOf and require a space before it. One trimEnd + one
// lastIndexOf, no anchored scan over the full string.
function stripTrailingTitle(s: string): string {
  let end = s.length;
  while (end > 0 && WHITESPACE_RE.test(s[end - 1]!)) end--;
  if (end === 0) return s;
  const last = s[end - 1]!;
  let open: number;
  if (last === '"' || last === "'") open = s.lastIndexOf(last, end - 2);
  else if (last === ")") open = s.lastIndexOf("(", end - 2);
  else return s; // the destination does not end with a title token
  // Need an opener (open >= 0) with room for the required preceding whitespace,
  // and that char before the opener must actually be whitespace.
  if (open < 1 || !WHITESPACE_RE.test(s[open - 1]!)) return s;
  let cut = open;
  while (cut > 0 && WHITESPACE_RE.test(s[cut - 1]!)) cut--;
  return s.slice(0, cut);
}

// The result of parsing one CommonMark link destination.
export interface ScannedLink {
  label: string;
  /** The on-disk-resolvable path: escapes resolved, angle unwrapped, trailing title stripped, unescaped fragment removed. "" when malformed. */
  target: string;
  /** As `target` but with the trailing title kept — feeds the D3 ladder's raw-vs-normalized step. "" when malformed. */
  rawTarget: string;
  line: number;
  /** True for an unclosed `<…>` destination — not a valid link, surfaced (F4) rather than silently turned into a phantom target. */
  malformed: boolean;
}

interface DestResult {
  target: string;
  rawTarget: string;
  malformed: boolean;
  end: number;
}

// Parse one CommonMark link destination beginning at `start` (the char after
// the link's `(`), in a single linear pass. A regex structurally cannot do this
// — destinations permit backslash-escaped delimiters and arbitrarily nested
// balanced parens, neither a regular language — which was the root of the
// escaped-delimiter false positives (F1/F2), the nested-paren silent drop
// (F3/G4B), and the angle mishandling (G4A/F4). Being a scan and not a
// backtracking pattern, it also carries no catastrophic-backtracking surface
// (S6/ADR-0013). Returns the normalized `target`, the pre-title-strip
// `rawTarget`, whether the destination is malformed, and `end` (index just past
// the link's closing `)`), so the scanner can continue.
function readDestination(s: string, start: number): DestResult {
  let i = start;
  // Whitespace between `(` and the destination is not part of it (CommonMark).
  while (i < s.length && WHITESPACE_RE.test(s[i]!)) i++;
  if (s[i] === "<") {
    // Angle form: read to the first UNESCAPED `>`. `\>` is a literal `>`. An
    // angle destination that never closes is malformed — not a link — so emit no
    // target (F4); still advance past the region so scanning continues.
    i++;
    let content = "";
    let fragPos = -1;
    let closed = false;
    while (i < s.length) {
      const c = s[i]!;
      if (c === "\\" && i + 1 < s.length) {
        content += s[i + 1]!;
        i += 2;
        continue;
      }
      if (c === ">") {
        closed = true;
        i++;
        break;
      }
      if (c === "\n") break;
      if (c === "#" && fragPos === -1) fragPos = content.length;
      content += c;
      i++;
    }
    if (!closed) {
      const j = s.indexOf(")", start);
      return { target: "", rawTarget: "", malformed: true, end: j === -1 ? s.length : j + 1 };
    }
    // A title may follow the `>` up to the link's `)`; discard it.
    const j = s.indexOf(")", i);
    const end = j === -1 ? s.length : j + 1;
    const noFrag = fragPos === -1 ? content : content.slice(0, fragPos);
    return { target: noFrag, rawTarget: noFrag, malformed: false, end };
  }

  // Bare form: track paren depth and escapes. `\<punct>` → the escaped char is
  // literal (an escaped `)` or `#` does not delimit — F1/F2). `(` deepens, `)`
  // at depth 0 closes the link (nested parens are kept — F3/G4B). Record the
  // first UNESCAPED `#` as the fragment start.
  let depth = 0;
  let dest = "";
  let fragPos = -1;
  let closed = false;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length) {
      dest += s[i + 1]!;
      i += 2;
      continue;
    }
    if (c === "(") {
      depth++;
      dest += c;
      i++;
      continue;
    }
    if (c === ")") {
      if (depth > 0) {
        depth--;
        dest += c;
        i++;
        continue;
      }
      closed = true;
      i++;
      break;
    }
    if (c === "#" && fragPos === -1) fragPos = dest.length;
    dest += c;
    i++;
  }
  // Trailing whitespace before the link's `)` is not part of the destination
  // (internal spaces — the edgex image case — are kept by trimEnd).
  const noFrag = (fragPos === -1 ? dest : dest.slice(0, fragPos)).trimEnd();
  // Strip only a recognizable trailing title (linear, S6-safe) — a bare path
  // with spaces and no trailing title is kept (the edgex image case).
  return { target: stripTrailingTitle(noFrag), rawTarget: noFrag, malformed: false, end: closed ? i : s.length };
}

// The one link scanner. Finds each `[label](destination)` inline link per line
// and yields the parsed destination. D3 reads this via `parsed.links` and D7 via
// `extractLinkTargets`, so link parsing has exactly one implementation and the
// checks cannot diverge on it.
export function scanLinks(text: string): ScannedLink[] {
  const out: ScannedLink[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    let i = 0;
    while (i < line.length) {
      if (line[i] !== "[") {
        i++;
        continue;
      }
      const close = line.indexOf("]", i + 1);
      if (close === -1) break; // no label close on this line
      if (line[close + 1] !== "(") {
        i = close + 1; // `[...]` not followed by `(` — not an inline link
        continue;
      }
      const d = readDestination(line, close + 2);
      out.push({ label: line.slice(i + 1, close), target: d.target, rawTarget: d.rawTarget, line: idx + 1, malformed: d.malformed });
      i = d.end;
    }
  });
  return out;
}

// Normalize a single raw destination string (the bytes a caller already has
// between the parens) to its resolvable path — the same core the scanner runs,
// wrapped for the unit contract and any single-string caller. Appending a `)`
// gives readDestination the link-close sentinel it scans to.
export function normalizeLinkDestination(raw: string): string {
  return readDestination(`${raw})`, 0).target;
}

// Percent-decode a link target for on-disk resolution (C4). "%20" is how a
// space in a filename is written in a link; the file on disk has a real space.
// A malformed escape (a stray "%") can't be decoded — keep the raw target
// rather than throw. Shared by D3 and D7 so an index entry and an ADR-body link
// to the same percent-encoded file resolve identically (C1): D7 used to skip
// this and diverge, flagging a real `0001-a b.md` as both missing and unlisted.
export function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

// The one link-extraction helper. Runs the shared scanner; D7 imports this for
// index content, and ADR-body extraction (`extractLinks`) shares the same
// scanner so D3 and D7 can never re-diverge. Malformed links carry no target.
export function extractLinkTargets(markdown: string): { target: string; line: number }[] {
  return scanLinks(markdown)
    .filter((l) => !l.malformed)
    .map((l) => ({ target: l.target, line: l.line }));
}

// HTML comments are template/instructional boilerplate, invisible when
// rendered — never real document content. Found running R5's edgex-docs:
// a lingering example block inside <!-- --> (literal placeholder text,
// "URL of PR") was being scanned as if it were a live broken link. Replace
// each comment with the same number of newlines it contained, not an empty
// string, so line numbers for anything after the comment stay accurate.
function stripHtmlComments(body: string): string {
  return body.replace(HTML_COMMENT_RE, (match) => "\n".repeat((match.match(/\n/g) ?? []).length));
}

// A bare-digit prefix ("0001-foo.md") is one convention among several real
// ones (found running R5's calibration corpus): "adr-002-foo.md",
// "adr001-foo.md" (letters glued to the number, no separator), "ODH-ADR-
// 0001-foo.md" (project-prefixed, letters repeated). A run of letters and
// hyphens, then the number, then a required hyphen, keeps this from matching
// ordinary docs (README.md, PROCESS.md) that have no digits at all.
//
// The prefix is a single character-class quantifier, NOT the nested
// `(?:[a-zA-Z]+-?)*` this used to be (S6, ADR-0013): that nesting caused
// catastrophic backtracking on a letters-only filename with no digit — one
// crafted ~50-char name under docs/adr pinned a CPU until CI's kill. The
// class excludes digits, so the prefix and `\d+` can't overlap and the match
// is linear.
export const ADR_FILENAME_RE = /^[a-zA-Z-]*(\d+)-.*\.md$/i;

// `fileName` may be a bare basename ("0001-foo.md") or, once ADR discovery
// recurses into subdirectories (ADR-0007), a path relative to the ADR root
// ("team/0001-foo.md") — the numeric-prefix pattern only makes sense
// against the last segment, since a directory name earlier in the path
// could itself contain digits.
function parseAdrNumber(fileName: string): number | null {
  const base = fileName.split("/").pop() ?? fileName;
  const match = ADR_FILENAME_RE.exec(base);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

type FrontmatterState = "present" | "malformed" | "absent";

function splitFrontmatter(raw: string): {
  frontmatter: AdrFrontmatter;
  body: string;
  state: FrontmatterState;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    // No `---` block at all. Might be a legitimate frontmatter-less ADR
    // (status recorded in a `## Status` section) — surfaced softly by D1, not
    // treated as broken.
    return { frontmatter: {}, body: raw, state: "absent" };
  }
  const [, yamlText, body] = match;
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText ?? "");
  } catch {
    // The `---` block is present but its YAML is broken (an unterminated flow
    // sequence, a duplicate key). Before S5 this threw and crashed the whole
    // run; now the broken ADR is surfaced as a D1 finding (ADR-0013).
    return { frontmatter: {}, body: body ?? "", state: "malformed" };
  }
  if (parsed === null || parsed === undefined) {
    // An empty `---\n---` block — present but carries nothing. Not broken.
    return { frontmatter: {}, body: body ?? "", state: "present" };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    // Frontmatter that parses to a bare string or a list, not a mapping.
    // Before S5 this was silently cast to an empty frontmatter and the broken
    // ADR passed clean — the confirmed silent-swallow (ADR-0013).
    return { frontmatter: {}, body: body ?? "", state: "malformed" };
  }
  return { frontmatter: parsed as AdrFrontmatter, body: body ?? "", state: "present" };
}

function parseSections(body: string): AdrSection[] {
  const lines = body.split(/\r?\n/);
  const sections: AdrSection[] = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;

  for (const line of lines) {
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      if (current) {
        sections.push({
          heading: current.heading,
          level: current.level,
          body: current.lines.join("\n").trim(),
        });
      }
      current = { heading: headingMatch[2]!.trim(), level: headingMatch[1]!.length, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    sections.push({ heading: current.heading, level: current.level, body: current.lines.join("\n").trim() });
  }
  return sections;
}

function extractTitle(sections: AdrSection[]): string | null {
  const h1 = sections.find((s) => s.level === 1);
  return h1?.heading ?? null;
}

function extractLinks(body: string): AdrLink[] {
  // One scanner produces `parsed.links`; D3 reads target (resolvable path),
  // rawTarget (pre-title-strip, for the ambiguity ladder), and malformed (an
  // unclosed angle destination it surfaces as an advisory rather than a phantom
  // dangling finding — F4).
  return scanLinks(body).map((l) => ({
    text: l.label,
    target: l.target,
    rawTarget: l.rawTarget,
    line: l.line,
    malformed: l.malformed,
  }));
}

export function parseAdrFile(raw: string, filePath: string, fileName: string): ParsedAdr {
  const { frontmatter, body: rawBody, state: frontmatterState } = splitFrontmatter(raw);
  // A status is the same decision state regardless of case or surrounding
  // space: "Accepted" — the most common ADR status and Nygard's own canonical
  // spelling — is not a different status from "accepted" (C3, ADR-0013).
  // Normalize once here so every downstream check sees one canonical form,
  // rather than each comparing case-sensitively: before this, a capitalized
  // status was fact-flagged invalid by D1 and made invisible to D2/D5/D6's
  // "accepted" gate and D4's dead-status set all at once.
  if (typeof frontmatter.status === "string") {
    frontmatter.status = frontmatter.status.trim().toLowerCase();
  }
  // `governs` accepts a single glob or a list; YAML gives a bare string for
  // the common `governs: src/**` shape (S4, ADR-0013). Normalize to an array
  // so D5's glob matching always has a list to iterate. Before this, a scalar
  // governs passed D5's `.length` guard (a string's length is truthy) and then
  // crashed the run on `.some`, which strings don't have. A value that is
  // neither string nor list (a number, a map) can't be a glob — drop it to an
  // empty list rather than crash.
  const rawGoverns: unknown = frontmatter.governs;
  if (typeof rawGoverns === "string") {
    frontmatter.governs = [rawGoverns];
  } else if (Array.isArray(rawGoverns)) {
    frontmatter.governs = rawGoverns.map((g) => String(g));
  } else if (rawGoverns !== undefined) {
    frontmatter.governs = [];
  }
  const body = stripHtmlComments(rawBody);
  const sections = parseSections(body);
  return {
    filePath,
    fileName,
    number: parseAdrNumber(fileName),
    frontmatter,
    frontmatterState,
    title: extractTitle(sections),
    sections,
    links: extractLinks(body),
    dialect: detectDialect(sections),
    raw,
  };
}
