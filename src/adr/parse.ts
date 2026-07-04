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
      links.push({ text: match[1] ?? "", target: match[2] ?? "", line: idx + 1 });
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
