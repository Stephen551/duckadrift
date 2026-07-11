import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import type { AdrLogContext } from "../src/adr/types.js";
import type { Tier1Finding } from "../src/tier1/citations.js";
import { confirmDeadPremise } from "../src/tier1/confirm-premise.js";

// The deterministic dead-premise confirmation (ADR-0036), stage 2 of S5 — the
// primary proof of the fix, API-free. A concretely-named referent provably
// absent is decay; a present referent, a premise naming nothing concrete, or a
// token escaping the repo root is NOT decay. Zero false positives by
// construction.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-confirm-premise");

function writeRepo(files: Record<string, string>): AdrLogContext {
  rmSync(TMP, { recursive: true, force: true });
  // A minimal ADR log so loadAdrLog gives a real context (repoRoot is what the
  // confirmation reads).
  const all = {
    "docs/adr/0001-x.md":
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n",
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    const abs = join(TMP, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return loadAdrLog(TMP);
}

function findingWithQuote(quote: string): Tier1Finding {
  return {
    check: "S5",
    claim: "premise",
    citations: [{ document: "0001-x.md", quote }],
    consequence: "verify",
    reportedConfidence: 0.7,
  };
}

describe("confirmDeadPremise — dependency referents", () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it("a dependency present in package.json → not dead (referent-present)", () => {
    const ctx = writeRepo({ "package.json": JSON.stringify({ dependencies: { "left-pad": "^1.0.0" } }) });
    const v = confirmDeadPremise(findingWithQuote("leans on `left-pad`, pinned in package.json"), ctx);
    expect(v).toEqual({ dead: false, reason: "referent-present" });
  });

  it("a dependency absent from package.json → dead (kind: dependency)", () => {
    const ctx = writeRepo({ "package.json": JSON.stringify({ dependencies: { yaml: "^2.0.0" } }) });
    const v = confirmDeadPremise(findingWithQuote("leans on `leftpad-classic`, pinned in package.json"), ctx);
    expect(v).toEqual({ dead: true, referent: { kind: "dependency", value: "leftpad-classic" } });
  });

  it("finds the dependency across devDependencies and peerDependencies too", () => {
    const ctx = writeRepo({
      "package.json": JSON.stringify({ devDependencies: { esbuild: "1" }, peerDependencies: { react: "1" } }),
    });
    expect(confirmDeadPremise(findingWithQuote("the `esbuild` dependency in package.json"), ctx).dead).toBe(false);
    expect(confirmDeadPremise(findingWithQuote("the `react` dependency in package.json"), ctx).dead).toBe(false);
  });

  it("a package-name token WITHOUT dependency language is not a concrete referent", () => {
    const ctx = writeRepo({ "package.json": JSON.stringify({ dependencies: {} }) });
    // No "dependency"/"package.json"/"pinned" context around the token.
    const v = confirmDeadPremise(findingWithQuote("the `widget` approach is used here"), ctx);
    expect(v).toEqual({ dead: false, reason: "no-concrete-referent" });
  });
});

describe("confirmDeadPremise — path referents", () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it("a path that exists on disk → not dead", () => {
    const ctx = writeRepo({ "src/pipeline/color.ts": "export const x = 1;\n" });
    const v = confirmDeadPremise(findingWithQuote("the conversion lives in `src/pipeline/color.ts`"), ctx);
    expect(v).toEqual({ dead: false, reason: "referent-present" });
  });

  it("a path absent from disk → dead (kind: path)", () => {
    const ctx = writeRepo({ "src/render/draw.ts": "export const y = 1;\n" });
    const v = confirmDeadPremise(findingWithQuote("the conversion lives in `src/pipeline/color.ts`"), ctx);
    expect(v).toEqual({ dead: true, referent: { kind: "path", value: "src/pipeline/color.ts" } });
  });

  it("a path token escaping the repo root is NOT decay (containment control)", () => {
    const ctx = writeRepo({ "package.json": JSON.stringify({ dependencies: {} }) });
    // An escape must not be mistaken for an absent-in-repo path.
    const v = confirmDeadPremise(findingWithQuote("depends on `../../etc/passwd.conf`"), ctx);
    expect(v).toEqual({ dead: false, reason: "no-concrete-referent" });
  });
});

describe("confirmDeadPremise — the clean-baseline shape", () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it("a premise naming no path and no package → no-concrete-referent (not decay)", () => {
    const ctx = writeRepo({ "package.json": JSON.stringify({ dependencies: {} }) });
    const v = confirmDeadPremise(
      findingWithQuote("The spell-check dictionary in the docs toolchain is pinned to that locale."),
      ctx
    );
    expect(v).toEqual({ dead: false, reason: "no-concrete-referent" });
  });

  it("one dead referent among several tokens makes the finding decay", () => {
    const ctx = writeRepo({
      "package.json": JSON.stringify({ dependencies: { yaml: "^2.0.0" } }),
      "src/pipeline/color.ts": "export const x = 1;\n",
    });
    // color.ts present, leftpad-classic absent → dead wins.
    const v = confirmDeadPremise(
      findingWithQuote("leans on `leftpad-classic`, pinned in package.json, and lives in `src/pipeline/color.ts`"),
      ctx
    );
    expect(v.dead).toBe(true);
    if (v.dead) expect(v.referent.value).toBe("leftpad-classic");
  });
});
