export type Dialect = "nygard" | "madr" | "loose" | "unknown";

/**
 * Declares what "unique" means for ADR numbers (ADR-0008). "per-directory"
 * (default) scopes uniqueness to each directory — a real per-team numbering
 * convention (found running R5's opendatahub) means the same number can
 * legitimately recur in a sibling directory. "global" restores the whole-
 * ADR-root uniqueness this tool originally assumed, for repos that declare
 * numbers must be unique across the entire log regardless of directory.
 */
export type NumberingScope = "global" | "per-directory";

/**
 * Declares whether a numbering gap fails CI or is surfaced softly
 * (ADR-0010). "advisory" (default) treats a gap as a provable state, not a
 * provable error — numbers retire legitimately in real, mature logs.
 * "fail" restores the original hard-fail behavior for repos that want
 * numbering gaps caught as errors.
 */
export type NumberingGapsMode = "advisory" | "fail";

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
  /**
   * Resolved from `.duckadrift.yml`'s `numbering:` key; defaults to
   * "per-directory" when not declared (ADR-0008). Always a definite value —
   * the defaulting happens once, at load time, not per-check.
   */
  numberingScope: NumberingScope;
  /**
   * Resolved from `.duckadrift.yml`'s `numbering_gaps:` key; defaults to
   * "advisory" when not declared (ADR-0010). Always a definite value — the
   * defaulting happens once, at load time, not per-check.
   */
  numberingGapsMode: NumberingGapsMode;
}
