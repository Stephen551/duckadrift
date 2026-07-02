export type Dialect = "nygard" | "madr" | "unknown";

export interface AdrFrontmatter {
  status?: string;
  date?: string;
  severity?: string;
  governs?: string[];
  "review-by"?: string;
  "superseded-by"?: string | number;
  supersedes?: string | number | Array<string | number>;
  [key: string]: unknown;
}

export interface AdrSection {
  heading: string;
  level: number;
  body: string;
}

export interface AdrLink {
  text: string;
  target: string;
  line: number;
}

export interface ParsedAdr {
  /** Absolute path to the ADR file. */
  filePath: string;
  /** Bare filename, e.g. "0001-first-decision.md" — the evidence.adr reference. */
  fileName: string;
  /** Parsed from the filename's numeric prefix; null if unparseable. */
  number: number | null;
  frontmatter: AdrFrontmatter;
  title: string | null;
  sections: AdrSection[];
  links: AdrLink[];
  dialect: Dialect;
  raw: string;
}

export interface PrContext {
  changedFiles: string[];
  commitMessage?: string;
  prBody?: string;
}

export interface AdrLogContext {
  /** Root of the repo the ADR log lives in (for resolving file: references). */
  repoRoot: string;
  /** Absolute path to the detected ADR directory (docs/adr or doc/adr). */
  adrDir: string;
  adrs: ParsedAdr[];
  indexPath: string | null;
  indexContent: string | null;
  /** PR-diff context for D5; null in schedule/no-diff mode. */
  prContext: PrContext | null;
}
