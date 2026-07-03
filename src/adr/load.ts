import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { loadConfig } from "../config/load.js";
import { SetupError } from "../errors.js";
import { walkRepoFiles } from "../repo/walk.js";
import { ADR_FILENAME_RE, parseAdrFile } from "./parse.js";
import type { AdrLogContext, PrContext } from "./types.js";

const ADR_DIR_CANDIDATES = ["docs/adr", "doc/adr"];
const INDEX_FILE_RE = /^readme\.md$/i;
// The index lives at the ADR root only — a nested README documents its own
// subdirectory, not the log as a whole, and isn't assumed to be a second
// table of contents.
const CANDIDATE_EXTENSIONS = new Set([".md", ".mdx"]);

export function detectAdrDir(repoRoot: string): string {
  for (const candidate of ADR_DIR_CANDIDATES) {
    const full = join(repoRoot, candidate);
    if (existsSync(full) && statSync(full).isDirectory()) {
      return full;
    }
  }
  throw new SetupError(
    `No ADR directory found under ${repoRoot} (looked for ${ADR_DIR_CANDIDATES.join(", ")}). ` +
      `If this repo keeps ADRs elsewhere, pass --adr-dir <path>.`
  );
}

/** Explicit override bypasses auto-detection entirely — for repos whose ADR log isn't at docs/adr or doc/adr. */
export function resolveAdrDir(repoRoot: string, adrDirOverride?: string): string {
  if (!adrDirOverride) return detectAdrDir(repoRoot);

  const full = isAbsolute(adrDirOverride) ? adrDirOverride : join(repoRoot, adrDirOverride);
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw new SetupError(`--adr-dir does not point to an existing directory: ${full}`);
  }
  return full;
}

export function loadPrContext(path: string | undefined): PrContext | null {
  if (!path) return null;
  if (!existsSync(path)) {
    throw new SetupError(`PR context file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as PrContext;
}

export function loadAdrLog(
  repoRoot: string,
  prContextPath?: string,
  adrDirOverride?: string
): AdrLogContext {
  const adrDir = resolveAdrDir(repoRoot, adrDirOverride);

  // Recurses under the ADR root (ADR-0007) — real logs group ADRs into
  // per-team/per-area subdirectories (found running R5's opendatahub,
  // whose actual decisions live under operator/, mlflow/, autox/, etc.,
  // which the old top-level-only readdirSync never saw at all). Reuses
  // walkRepoFiles' directory-exclusion and file-size safeguards rather
  // than a bespoke recursive readdir.
  const candidateFiles = walkRepoFiles(adrDir).filter((f) =>
    CANDIDATE_EXTENSIONS.has(extname(f.relativePath).toLowerCase())
  );

  const adrs: AdrLogContext["adrs"] = [];
  const unrecognizedFiles: string[] = [];
  let indexPath: string | null = null;
  let indexContent: string | null = null;

  for (const file of candidateFiles) {
    const isAtRoot = !file.relativePath.includes("/");
    if (isAtRoot && INDEX_FILE_RE.test(file.relativePath)) {
      indexPath = file.absolutePath;
      indexContent = file.content;
      continue;
    }

    const baseName = file.relativePath.split("/").pop()!;
    if (!ADR_FILENAME_RE.test(baseName)) {
      // Silence is a violation regardless of cause (ADR-0007): a markdown
      // file under the ADR root that isn't recognized as an ADR or the
      // index must be surfaced, not silently dropped from consideration —
      // whether it's legitimately non-ADR documentation or a real decision
      // this tool's naming heuristic failed to catch is a human's call,
      // not something to guess silently either way.
      unrecognizedFiles.push(relative(repoRoot, file.absolutePath).split("\\").join("/"));
      continue;
    }

    adrs.push(parseAdrFile(file.content, file.absolutePath, file.relativePath));
  }

  adrs.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  unrecognizedFiles.sort();

  // A declared dialect is a repo-wide assertion, not a per-file guess: it
  // overrides auto-detection for every ADR, and unlocks fact-mode claims
  // that rest on dialect (D1's missing-section check, ADR-0005).
  const config = loadConfig(repoRoot);
  const dialectDeclared = config.dialect !== undefined;
  if (config.dialect !== undefined) {
    for (const adr of adrs) adr.dialect = config.dialect;
  }
  // Defaults to per-directory (ADR-0008) — a repo declares "global" only if
  // its numbers really must be unique across the whole ADR root.
  const numberingScope = config.numbering ?? "per-directory";
  // Defaults to advisory (ADR-0010) — a repo declares "fail" only if it
  // wants numbering gaps caught as errors, not just surfaced.
  const numberingGapsMode = config.numbering_gaps ?? "advisory";

  return {
    repoRoot,
    adrDir,
    adrs,
    indexPath,
    indexContent,
    unrecognizedFiles,
    prContext: loadPrContext(prContextPath),
    dialectDeclared,
    numberingScope,
    numberingGapsMode,
  };
}
