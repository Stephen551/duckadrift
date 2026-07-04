import { parse as parseYaml } from "yaml";
import { detectDialect } from "./dialect.js";
import type { AdrFrontmatter, AdrLink, AdrSection, ParsedAdr } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
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
// 0001-foo.md" (project-prefixed, letters repeated). Zero or more letter(-)
// groups, then the number, then a required hyphen, keeps this from matching
// ordinary docs (README.md, PROCESS.md) that have no digits at all.
export const ADR_FILENAME_RE = /^(?:[a-zA-Z]+-?)*(\d+)-.*\.md$/i;

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

function splitFrontmatter(raw: string): { frontmatter: AdrFrontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const [, yamlText, body] = match;
  const parsed = (parseYaml(yamlText ?? "") ?? {}) as AdrFrontmatter;
  return { frontmatter: parsed, body: body ?? "" };
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
  const { frontmatter, body: rawBody } = splitFrontmatter(raw);
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
  const body = stripHtmlComments(rawBody);
  const sections = parseSections(body);
  return {
    filePath,
    fileName,
    number: parseAdrNumber(fileName),
    frontmatter,
    title: extractTitle(sections),
    sections,
    links: extractLinks(body),
    dialect: detectDialect(sections),
    raw,
  };
}
