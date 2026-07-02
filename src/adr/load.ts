import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
  throw new Error(
    `No ADR directory found under ${repoRoot} (looked for ${ADR_DIR_CANDIDATES.join(", ")})`
  );
}

export function loadPrContext(path: string | undefined): PrContext | null {
  if (!path) return null;
  if (!existsSync(path)) {
    throw new Error(`PR context file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as PrContext;
}

export function loadAdrLog(repoRoot: string, prContextPath?: string): AdrLogContext {
  const adrDir = detectAdrDir(repoRoot);
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

  return {
    repoRoot,
    adrDir,
    adrs,
    indexPath,
    indexContent,
    prContext: loadPrContext(prContextPath),
  };
}
