import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

// duckadrift's own fixture-harness convention (test/fixtures/tier0/**), never
// real repo content — excluded so the harness's own ground-truth JSON doesn't
// contaminate scans (e.g. D4 matching "ADR-0001" inside expected-findings.json).
const EXCLUDED_FILES = new Set(["expected-findings.json", "pr-context.json"]);

export interface RepoFile {
  relativePath: string;
  absolutePath: string;
  content: string;
}

/** Walks every file under `repoRoot`, skipping `excludeDirs` (repo-root-relative, exact-name match at any depth). */
export function walkRepoFiles(repoRoot: string, excludeDirs: string[] = []): RepoFile[] {
  const excluded = new Set([...EXCLUDED_DIRS, ...excludeDirs]);
  const results: RepoFile[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (excluded.has(entry) || EXCLUDED_FILES.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        results.push({
          relativePath: relative(repoRoot, full).split("\\").join("/"),
          absolutePath: full,
          content: readFileSync(full, "utf-8"),
        });
      }
    }
  }

  walk(repoRoot);
  return results;
}
