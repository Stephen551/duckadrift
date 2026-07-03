import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  "tmp",
  "temp",
]);

// duckadrift's own fixture-harness convention (test/fixtures/tier0/**), never
// real repo content — excluded so the harness's own ground-truth JSON doesn't
// contaminate scans (e.g. D4 matching "ADR-0001" inside expected-findings.json).
const EXCLUDED_FILES = new Set(["expected-findings.json", "pr-context.json"]);

// D4 scans "code/comments/docs" (PDR §2.3) for citations — never binary assets,
// media, or data files. An allowlist, not a denylist: real repos accumulate
// large binary trees (image caches, datasets, build output) no size-based
// heuristic alone reliably catches, and reading gigabytes of non-text content
// as UTF-8 strings is both wasted work and an OOM risk (found running this
// against a 32GB real repo during the G1 exam).
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".yaml",
  ".yml",
  ".toml",
  ".json",
  ".sh",
  ".bash",
  ".ps1",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".vue",
  ".svelte",
  ".sql",
]);

// Belt and suspenders alongside the extension allowlist: a legitimate text
// file this large is not something a citation scan needs to read in full.
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export interface RepoFile {
  relativePath: string;
  absolutePath: string;
  content: string;
}

/** Walks text/code/doc files under `repoRoot`, skipping `excludeDirs` (repo-root-relative, exact-name match at any depth). */
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
        if (!TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
        if (stat.size > MAX_FILE_SIZE_BYTES) continue;
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
