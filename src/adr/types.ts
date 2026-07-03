export type Dialect = "nygard" | "madr" | "loose" | "unknown";

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
  /**
   * Path relative to the ADR root, e.g. "0001-first-decision.md" — or,
   * once ADR discovery recurses into subdirectories (ADR-0007),
   * "team/0001-first-decision.md". Equals the bare basename for every ADR
   * at the root, which is every ADR in every fixture and repo this tool
   * saw before ADR-0007. The evidence.adr reference.
   */
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
  /**
   * Repo-root-relative paths of markdown/MDX files found recursively under
   * the ADR root that are neither the index nor ADR_FILENAME_RE-shaped
   * (ADR-0007). Always surfaced in the report — silent partial coverage
   * violates the Pact regardless of cause, even when the file turns out to
   * be legitimately non-ADR documentation.
   */
  unrecognizedFiles: string[];
  /** PR-diff context for D5; null in schedule/no-diff mode. */
  prContext: PrContext | null;
  /**
   * True when the user explicitly declared a dialect in `.duckadrift.yml`.
   * False means dialect is auto-detected (a guess) — checks resting on
   * dialect (D1's missing-section claim) must be advisory, not fact,
   * when this is false (ADR-0005).
   */
  dialectDeclared: boolean;
}
