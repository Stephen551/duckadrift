import { parse as parseYaml } from "yaml";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Link, LinkReference, RootContent } from "mdast";
import { detectDialect } from "./dialect.js";
import type { AdrFrontmatter, AdrLink, AdrSection, ParsedAdr } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

const WHITESPACE_RE = /\s/;
// CommonMark backslash escaping: a backslash before ASCII punctuation escapes
// that character (the backslash is dropped); before anything else the backslash
// is literal (NEW-3 — the scanner wrongly dropped it, a clause-A FP on a file
// named `foo\nbar.md`).
const ASCII_PUNCT_RE = /[!-/:-@[-`{-~]/;

// The result of extracting one link.
export interface ScannedLink {
  label: string;
  /** The on-disk-resolvable path: escapes resolved (CommonMark rules), fragment removed. */
  target: string;
  /** As `target` but with the trailing title/paren-group kept — feeds the D3 ladder's raw rung (now rarely exercised). */
  rawTarget: string;
  line: number;
  /** Retained for the AdrLink shape; a spec parser never yields a malformed link (it drops one), so this is always false. */
  malformed: boolean;
}

// Resolve CommonMark backslash escapes: `\<ascii-punct>` → the punctuation
// char; `\<anything-else>` → both characters kept (NEW-3). This matches
// mdast's own destination resolution, so a bare inline dest processed here
// equals the parser's `url` — we use it to recover the fragment escape-aware.
function resolveEscapes(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length && ASCII_PUNCT_RE.test(s[i + 1]!)) {
      out += s[i + 1]!;
      i++;
    } else {
      out += s[i]!;
    }
  }
  return out;
}

// Strip a trailing `#fragment` from a RAW (pre-escape-resolution) destination,
// cutting at the first UNESCAPED `#`. An escaped `\#` is a literal `#` in the
// filename and is kept (constraint A): a spec parser resolves `\#`→`#` and loses
// the distinction, so the fragment must be found in the raw source, not the
// resolved url.
function stripUnescapedFragment(rawDest: string): string {
  for (let i = 0; i < rawDest.length; i++) {
    if (rawDest[i] === "\\") {
      i++;
      continue;
    }
    if (rawDest[i] === "#") return rawDest.slice(0, i);
  }
  return rawDest;
}

// The raw bytes of a BARE inline destination, sliced from source, or undefined
// for an angle-bracketed dest (whose `url` the parser already resolves cleanly).
// mdast exposes link and label-child positions but not the destination's own
// span, so it is derived: past the label's `]` and `(`, then to the first
// unescaped whitespace (a title separator) or the closing `)` at paren depth 0.
// The link is already parser-validated, so this scan only ever runs on a
// well-formed destination (no NEW-1/2/3 boundary hazards reach here).
function bareInlineDest(text: string, node: Link): string | undefined {
  const kids = node.children;
  let p = kids.length ? kids[kids.length - 1]!.position!.end.offset! : node.position!.start.offset! + 1;
  while (p < text.length && text[p] !== "(") p++;
  p++; // past '('
  while (p < text.length && WHITESPACE_RE.test(text[p]!)) p++;
  if (text[p] === "<") return undefined; // angle form — use node.url
  let depth = 0;
  let dest = "";
  for (let i = p; i < text.length; ) {
    const c = text[i]!;
    if (c === "\\") {
      dest += c + (text[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (WHITESPACE_RE.test(c)) break; // a title follows whitespace
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
      break; // link close
    }
    dest += c;
    i++;
  }
  return dest;
}

// Fragment-strip a url whose escapes are already resolved (angle dest or a
// reference definition) — the raw source isn't available, so strip at the first
// `#`. An escaped `#` in these forms is vanishingly rare.
function stripFragmentFromUrl(url: string): string {
  const h = url.indexOf("#");
  return h === -1 ? url : url.slice(0, h);
}

// The one link extractor — a spec-compliant CommonMark parse (mdast /
// micromark). It replaces the hand-rolled scanner, whose bespoke re-
// implementation of the grammar leaked three ways on the standing gate's probe
// (over-escape FP, dropped bracketed label, lenient unterminated paren) and
// never handled reference-style links or autolinks. The parser is correct on
// the grammar by construction. Two tool conventions sit on top, preserved
// explicitly: the escape-aware `#fragment` strip (constraint A, via the raw bare
// dest) and — deferred — space-bearing bare paths, which a strict parser drops
// (constraint B; documented as a LIMITS entry). D3 and D7 both read this, so
// link extraction has exactly one implementation.
export function scanLinks(text: string): ScannedLink[] {
  const tree = fromMarkdown(text);
  const definitions = new Map<string, string>();
  const linkNodes: Array<Link | LinkReference> = [];
  const walk = (node: RootContent | typeof tree): void => {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    if (node.type === "link" || node.type === "linkReference") linkNodes.push(node);
    if ("children" in node) for (const child of node.children) walk(child as RootContent);
  };
  walk(tree);

  const out: ScannedLink[] = [];
  for (const node of linkNodes) {
    let target: string;
    let rawTarget: string;
    if (node.type === "link") {
      // Both `[label](dest)` inline links and `<url>` autolinks are `link` nodes.
      // Only an inline link (source starts with `[`) has a raw destination to
      // slice for constraint A; an autolink's dest is its `url` (which D3 then
      // skips as external). Guarding this avoids scanning past an autolink to a
      // following `(...)` and extracting garbage (an edgex-docs autolink followed
      // by `(registration required)` — a differential catch).
      const isInline = node.position !== undefined && text[node.position.start.offset!] === "[";
      const raw = isInline ? bareInlineDest(text, node) : undefined;
      if (raw !== undefined) {
        // Bare inline dest: resolve escapes ourselves so the fragment strip is
        // escape-aware (constraint A). This equals the parser's url otherwise.
        rawTarget = resolveEscapes(raw);
        target = resolveEscapes(stripUnescapedFragment(raw));
      } else {
        // Angle dest: the parser's url is already unwrapped and escape-resolved.
        rawTarget = node.url;
        target = stripFragmentFromUrl(node.url);
      }
    } else {
      // Reference-style link: destination comes from the matching definition.
      const url = definitions.get(node.identifier);
      if (url === undefined) continue; // unresolved reference — not a link
      rawTarget = url;
      target = stripFragmentFromUrl(url);
    }
    out.push({ label: "", target, rawTarget, line: node.position?.start.line ?? 1, malformed: false });
  }
  return out;
}

// Normalize a single raw destination string — wrap it as an inline link and run
// the one extractor, for the unit contract and any single-string caller.
export function normalizeLinkDestination(raw: string): string {
  return scanLinks(`[x](${raw})`)[0]?.target ?? "";
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
