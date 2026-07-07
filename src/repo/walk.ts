import { lstatSync, readdirSync, readFileSync } from "node:fs";
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
// file this large is not something a citation scan needs to read in full. The
// one size-cap primitive — exported so the config read applies the same bound
// (B-10: `.duckadrift.yml` was read uncapped, a fork-reachable OOM at V8's
// string limit).
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

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
      // lstat, not stat: never follow a symlink (S2, ADR-0013). Before this,
      // statSync followed links, so a broken symlink under the ADR tree threw
      // ENOENT and a symlink cycle threw ELOOP (or looped) — either aborted
      // the whole run, which the Action then passed off as a silent green. A
      // symlink is skipped; a real repo's ADRs are not symlinks.
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
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

export interface RepoPath {
  relativePath: string;
  absolutePath: string;
}

/**
 * Walks every file under `repoRoot`, no extension or size filtering and no
 * content read — for existence/path lookups (D3's site-relative fallback,
 * ADR-0011) where the target could be any file type (a `.proto`, an image,
 * anything a relative link might cite), not just the text/code/doc subset
 * `walkRepoFiles` reads for content scanning. Shares the same directory
 * exclusions as walkRepoFiles, duplicated rather than factored out of it —
 * that function is already fixture-verified and load-bearing; a second,
 * simpler walker is safer than restructuring it.
 *
 * Traversal order is sorted per directory, not left as `readdirSync`
 * returns it. D3's basename index (ADR-0011) keeps only the first path it
 * sees for a given basename — with raw OS/filesystem order, a repeated
 * basename's evidence path is dealer's-choice per environment, breaking the
 * byte-identical-report guarantee (PDR §3.2). Sorting makes "first seen"
 * mean "lexicographically first," the same on every machine.
 */
export function walkAllPaths(repoRoot: string, excludeDirs: string[] = []): RepoPath[] {
  const excluded = new Set([...EXCLUDED_DIRS, ...excludeDirs]);
  const results: RepoPath[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir).sort()) {
      if (excluded.has(entry) || EXCLUDED_FILES.has(entry)) continue;
      const full = join(dir, entry);
      // lstat, not stat: never follow a symlink (S2, ADR-0013) — same crash
      // and cycle protection as walkRepoFiles.
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        results.push({
          relativePath: relative(repoRoot, full).split("\\").join("/"),
          absolutePath: full,
        });
      }
    }
  }

  walk(repoRoot);
  return results;
}
