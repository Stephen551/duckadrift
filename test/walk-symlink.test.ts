import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkAllPaths, walkRepoFiles } from "../src/repo/walk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-walk-symlink");

// S2 (ADR-0013): the walkers used statSync, which follows symlinks — a broken
// link threw ENOENT and a symlink cycle threw ELOOP (or looped), aborting the
// run, which the Action then passed off as a silent green. They now lstat and
// skip symlinks. A real file is still walked; the crash is gone.

describe("S2: the walkers tolerate symlinks instead of crashing", () => {
  let symlinkOk = false;
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, "docs", "adr"), { recursive: true });
    writeFileSync(join(TMP, "docs", "adr", "0001-real.md"), "# real\n");
    try {
      // A broken file symlink and a directory cycle — both crashed statSync.
      symlinkSync(join(TMP, "nowhere"), join(TMP, "docs", "adr", "0002-broken.md"), "file");
      symlinkSync(join(TMP, "docs", "adr"), join(TMP, "docs", "adr", "loop"), "junction");
      symlinkOk = true;
    } catch {
      symlinkOk = false;
    }
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("walkRepoFiles does not throw and still returns the real file", () => {
    if (!symlinkOk) {
      console.warn("S2 test SKIPPED: this environment cannot create a symlink.");
      return;
    }
    const files = walkRepoFiles(TMP);
    expect(files.some((f) => f.relativePath.endsWith("0001-real.md"))).toBe(true);
    // The broken symlink and the cycle are skipped, not walked or crashed on.
    expect(files.some((f) => f.relativePath.includes("0002-broken.md"))).toBe(false);
    expect(files.some((f) => f.relativePath.includes("loop"))).toBe(false);
  });

  it("walkAllPaths does not throw and still returns the real file", () => {
    if (!symlinkOk) return;
    const paths = walkAllPaths(TMP);
    expect(paths.some((p) => p.relativePath.endsWith("0001-real.md"))).toBe(true);
    expect(paths.some((p) => p.relativePath.includes("loop"))).toBe(false);
  });
});
