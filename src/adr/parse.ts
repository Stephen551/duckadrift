import { parse as parseYaml } from "yaml";
import { detectDialect } from "./dialect.js";
import type { AdrFrontmatter, AdrLink, AdrSection, ParsedAdr } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// The link-destination group allows balanced parentheses, one level deep —
// CommonMark permits them in a bare destination, and real paths use them
// (`client(v2).ts`, a versioned filename). A plain `([^)]+)` stopped the
// target at the first `)`, truncating `../src/client(v2).ts` to
// `../src/client(v2` and fact-flagging a real file as dangling (C1,
// ADR-0013). The two alternatives are disjoint (`[^()]` never starts with a
// paren; `\([^()]*\)` always does), so there is no backtracking ambiguity.
const LINK_RE = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;
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

// The single CommonMark-correct destination normalizer. LINK_RE captures
// everything between the outer parens — a destination plus an optional title —
// so the raw capture is not yet a resolvable path. Every link consumer (D3 via
// `parsed.links`, D7 via `extractLinkTargets`) runs its captured destination
// through this one function, so a hardening applied here reaches every check
// instead of one copy. Before consolidation, D3 saw the raw capture (angle
// brackets and titles left in, fact-flagging `<...>` and `path "title"` as
// dangling) and D7 re-parsed the index with its own pre-C1 regex that truncated
// a `foo(v2).md` filename at the first paren.
//
// CommonMark destination/title grammar (see the spec's "Links" section): a
// destination is either `<...>` (may contain spaces; ends at the first `>`) or a
// bare run with no unescaped whitespace and balanced parens; an optional title
// follows whitespace as `"..."`, `'...'`, or `(...)`. So: unwrap `<...>`, drop a
// whitespace-separated trailing title, keep balanced parens that have no
// preceding whitespace (a versioned filename), and strip a `#fragment` — the
// resolvable on-disk path is what every check needs.
export function normalizeLinkDestination(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("<")) {
    // Angle-bracketed: the destination is the content up to the first `>` and
    // may contain spaces; anything after `>` is a title, discarded.
    const end = s.indexOf(">");
    s = end === -1 ? s.slice(1) : s.slice(1, end);
  } else {
    // Bare destination, optionally followed by a title. Strip only a
    // RECOGNIZABLE trailing title (linear, see stripTrailingTitle) — not
    // everything after the first space. CommonMark requires a space-bearing
    // destination to be angle-bracketed, but real-world markdown (and MkDocs)
    // accepts a bare path with spaces — e.g. an image
    // `![](common-config-images/EdgeX 3.x flowchart.png)`, three of which are in
    // edgex-docs' ADR-0026. Truncating at the first space broke those real
    // references (a no-regression-differential catch); a versioned filename like
    // `client(v2).ts` has no whitespace-preceded trailing group and is kept.
    s = stripTrailingTitle(s);
  }
  // A fragment identifier is not part of the on-disk path (checks already
  // ignored it downstream; stripping here keeps the normalized target honest).
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash);
  return s;
}

// The one link-extraction helper. Runs LINK_RE per line and normalizes each
// captured destination. D7 imports this for index content; ADR-body extraction
// (`extractLinks`) shares the same normalizer so D3 and D7 can never re-diverge.
export function extractLinkTargets(markdown: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  markdown.split(/\r?\n/).forEach((line, idx) => {
    for (const match of line.matchAll(LINK_RE)) {
      out.push({ target: normalizeLinkDestination(match[2] ?? ""), line: idx + 1 });
    }
  });
  return out;
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
  const links: AdrLink[] = [];
  const lines = body.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(LINK_RE)) {
      // Normalize the destination so `parsed.links[].target` is the resolvable
      // path — D3 reads this and gets angle-bracket/title/fragment handling for
      // free, from the same normalizer D7 uses. rawTarget keeps the pre-
      // normalization capture so D3 can retry it on the dangling branch (G2),
      // distinguishing a stripped title from parens that are part of a filename.
      const raw = match[2] ?? "";
      links.push({ text: match[1] ?? "", target: normalizeLinkDestination(raw), rawTarget: raw, line: idx + 1 });
    }
  });
  return links;
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
