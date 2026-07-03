import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { loadConfig } from "../config/load.js";
import { SetupError } from "../errors.js";
import { parseAdrFile } from "./parse.js";
import type { AdrLogContext, PrContext } from "./types.js";

const ADR_DIR_CANDIDATES = ["docs/adr", "doc/adr"];
const ADR_FILE_RE = /^\d+-.*\.md$/i;
const INDEX_FILE_RE = /^readme\.md$/i;

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
  const entries = readdirSync(adrDir);

  const adrs: AdrLogContext["adrs"] = [];
  let indexPath: string | null = null;
  let indexContent: string | null = null;

  for (const entry of entries) {
    const full = join(adrDir, entry);
    if (!statSync(full).isFile()) continue;

    if (INDEX_FILE_RE.test(entry)) {
      indexPath = full;
      indexContent = readFileSync(full, "utf-8");
      continue;
    }
    if (!ADR_FILE_RE.test(entry)) continue;

    const raw = readFileSync(full, "utf-8");
    adrs.push(parseAdrFile(raw, full, entry));
  }

  adrs.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  // A declared dialect is a repo-wide assertion, not a per-file guess: it
  // overrides auto-detection for every ADR, and unlocks fact-mode claims
  // that rest on dialect (D1's missing-section check, ADR-0005).
  const config = loadConfig(repoRoot);
  const dialectDeclared = config.dialect !== undefined;
  if (config.dialect !== undefined) {
    for (const adr of adrs) adr.dialect = config.dialect;
  }

  return {
    repoRoot,
    adrDir,
    adrs,
    indexPath,
    indexContent,
    prContext: loadPrContext(prContextPath),
    dialectDeclared,
  };
}
