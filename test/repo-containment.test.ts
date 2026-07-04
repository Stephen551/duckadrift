import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-containment");
const REPO = join(TMP, "repo");
const OUTSIDE = join(TMP, "outside");

// S1 (ADR-0013): D3 resolved link targets with no repo-root containment, so a
// crafted `../`-escaping link that pointed at a real file above the checkout
// was treated as a valid HEAD reference. This needs a file that exists OUTSIDE
// the repo root, so it can't be a corpus fixture (whose root is its own dir) —
// hence a temp repo plus a sibling external file.

describe("S1: D3 does not resolve links outside the repo root", () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(REPO, "docs", "adr"), { recursive: true });
    mkdirSync(OUTSIDE, { recursive: true });
    // A real file one level ABOVE the repo root.
    writeFileSync(join(OUTSIDE, "secret.md"), "outside the repo\n");
    // An ADR whose link escapes the repo root to reach it.
    writeFileSync(
      join(REPO, "docs", "adr", "0001-escape.md"),
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\n[outside](../../../outside/secret.md)\n\n## Decision\nUse it.\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("a link resolving to a real file above the repo root is flagged dangling", () => {
    const findings = runSingleCheck(REPO, "D3");
    // The escaping target exists on disk (outside/secret.md) but is outside the
    // checkout. On v0.1.0 this was silently accepted (0 findings); now it is a
    // dangling reference, since a file outside the repo is not "at HEAD".
    const d3 = findings.filter((f) => f.check === "D3");
    expect(d3.length).toBe(1);
    expect(d3[0]!.claim).toMatch(/does not resolve at HEAD/);
    expect(d3[0]!.advisory).toBeUndefined(); // fact-tier: no in-repo basename match either
  });
});

// S1 post-audit (ADR-0013): the containment check above is purely lexical
// (resolve + relative), but existsSync follows symlinks. An in-repo symlink
// whose target is OUTSIDE the checkout has an in-repo lexical path — the
// `..` guard never trips — yet resolves on disk to an out-of-repo real file.
// On the shipped code that link was treated as a valid HEAD reference. The fix
// canonicalizes the resolved path through realpath and re-checks containment on
// the real path, so only a link whose real target is in-repo stays resolved.
const SYM_TMP = join(__dirname, "fixtures", ".tmp-containment-symlink");
const SYM_REPO = join(SYM_TMP, "repo");
const SYM_OUTSIDE = join(SYM_TMP, "outside");
let symlinkSupported = true;

describe("S1: D3 does not resolve an in-repo symlink that escapes the repo root", () => {
  beforeAll(() => {
    rmSync(SYM_TMP, { recursive: true, force: true });
    mkdirSync(join(SYM_REPO, "docs", "adr"), { recursive: true });
    mkdirSync(SYM_OUTSIDE, { recursive: true });
    // A real file OUTSIDE the repo root, reachable only by following the link.
    writeFileSync(join(SYM_OUTSIDE, "passwd"), "outside the repo\n");
    // An in-repo symlink under the ADR tree that points at the outside dir.
    // Junction on Windows (no elevation needed); dir symlink elsewhere. Where
    // the OS forbids the operation, skip loud (the old S0 test's pattern) —
    // never a silent green.
    const symType = process.platform === "win32" ? "junction" : "dir";
    try {
      // Escaping symlink: docs/adr/evil -> outside the repo.
      symlinkSync(SYM_OUTSIDE, join(SYM_REPO, "docs", "adr", "evil"), symType);
      // In-repo symlink: docs/adr/good -> the repo's own docs dir. A link
      // through this resolves to a real path INSIDE the repo and must stay
      // resolved after the fix — the fix blocks escapes, not all symlinks.
      symlinkSync(join(SYM_REPO, "docs"), join(SYM_REPO, "docs", "adr", "good"), symType);
    } catch (err) {
      symlinkSupported = false;
      // eslint-disable-next-line no-console
      console.warn(`S1 symlink test skipped: this OS/user cannot create symlinks (${String(err)})`);
    }
    writeFileSync(
      join(SYM_REPO, "docs", "adr", "0001-escape.md"),
      // [a] escapes via the symlink (in-repo lexical path, out-of-repo real
      // path — the bug). [b] escapes lexically with `..` (the already-fixed
      // control, must STAY dangling). [c] is a plain missing file (proves D3 is
      // emitting danglers at all this run, so an empty result can't pass as a
      // silent green). [d] goes through an in-repo symlink to a real in-repo
      // file (must STAY resolved — the fix must not over-block).
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\n" +
        "[a](evil/passwd)\n[b](../../../outside/passwd)\n[c](nope-missing.md)\n" +
        "[d](good/adr/0001-escape.md)\n\n" +
        "## Decision\nUse it.\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(SYM_TMP, { recursive: true, force: true }));

  it("the symlink-escaping link is a dangling D3 finding, not a resolved reference", () => {
    if (!symlinkSupported) return;
    const claims = runSingleCheck(SYM_REPO, "D3")
      .filter((f) => f.check === "D3")
      .map((f) => f.claim);
    // The whole point: the symlink target exists on disk but outside the repo,
    // so it is not at HEAD. On the shipped code this claim is absent (the link
    // was accepted as resolved) — this assertion is red before the fix.
    expect(claims.some((c) => c.includes("evil/passwd"))).toBe(true);
    // Controls: the lexical `..` escape and the plain missing file both stay
    // dangling, proving the fix neither regressed the lexical path nor silenced
    // the check.
    expect(claims.some((c) => c.includes("outside/passwd"))).toBe(true);
    expect(claims.some((c) => c.includes("nope-missing.md"))).toBe(true);
  });

  it("a legitimate in-repo symlink still resolves (only escapes are blocked)", () => {
    if (!symlinkSupported) return;
    // Regression guard: link [d] follows an in-repo symlink (good -> docs) to a
    // real file that lives inside the repo. Its real path is in-repo, so it
    // must NOT be flagged — the fix rejects out-of-repo real paths only.
    const claims = runSingleCheck(SYM_REPO, "D3")
      .filter((f) => f.check === "D3")
      .map((f) => f.claim);
    expect(claims.some((c) => c.includes("good/adr/0001-escape.md"))).toBe(false);
  });
});
