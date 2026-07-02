import { parse as parseYaml } from "yaml";
import { detectDialect } from "./dialect.js";
import type { AdrFrontmatter, AdrLink, AdrSection, ParsedAdr } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const NUMBER_PREFIX_RE = /^(\d+)-/;

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

function parseAdrNumber(fileName: string): number | null {
  const match = NUMBER_PREFIX_RE.exec(fileName);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export function parseAdrFile(raw: string, filePath: string, fileName: string): ParsedAdr {
  const { frontmatter, body } = splitFrontmatter(raw);
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
