import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
