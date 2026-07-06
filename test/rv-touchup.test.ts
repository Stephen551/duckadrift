import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";

// Post-re-attack touch-up — two low findings inside the shared
// isExternalReference primitive the full-surface batch created. Each fixture
// runs the engine, red on e959fd3.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-rv-touchup");

function writeRepo(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}

const adr = (n: string, body = "x") =>
  `---\nstatus: accepted\n---\n\n# ADR-${n}\n\n## Context\n${body}\n\n## Decision\ny\n\n## Consequences\nz\n`;

const d3 = (dir: string) => runSingleCheck(dir, "D3").filter((f) => f.check === "D3");
const d7 = (dir: string) => runSingleCheck(dir, "D7").filter((f) => f.check === "D7");

describe("RV-1 — a single-letter scheme is a drive letter, not an external URL", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("D3: a bare drive-absolute path `C:/…` is resolved and flagged, not skipped as external", () => {
    // `EXTERNAL_SCHEME_RE`'s `*` let the one-letter scheme `C:` match, so a leaked
    // Windows-absolute path went uncaught. Requiring ≥2 chars before the colon
    // makes it a local path — dangling when the file does not exist.
    const dir = writeRepo({ "docs/adr/0001-a.md": adr("0001", "See [impl](C:/Users/leaked.md)") });
    const claims = d3(dir).map((f) => f.claim);
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("C:/Users/leaked.md");
  });

  it("D7: a drive-absolute index entry `C:/…` is reconciled and flagged, not skipped", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      "docs/adr/README.md": "# Index\n\n- [ADR 1](0001-a.md)\n- [leak](C:/Users/leaked.md)\n",
    });
    const drift = d7(dir).filter((f) => f.claim.includes("C:/Users/leaked.md") || f.claim.includes("leaked.md"));
    expect(drift.length).toBe(1);
  });

  it("control: real multi-character schemes still classify as external (skipped)", () => {
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001", "[a](https://x.com/y.md) [b](mailto:x@y.com) [c](ftp://h/f.md)"),
    });
    expect(d3(dir)).toEqual([]);
  });
});

describe("RV-2 — D3 adopts the full shared primitive (scheme + protocol-relative)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("D3 and D7 reach the same disposition on a `//host/…` protocol-relative reference (both skip)", () => {
    // D3 called the raw scheme regex directly, so it flagged `//host/p.md` as a
    // broken local link while D7 (on isExternalReference) skipped it — a
    // divergence in the primitive built to end divergence. D3 now uses the full
    // primitive, so both skip the protocol-relative external reference.
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001", "See [ext](//host/p.md)"),
      "docs/adr/README.md": "# Index\n\n- [ADR 1](0001-a.md)\n- [ext](//host/p.md)\n",
    });
    expect(d3(dir).some((f) => f.claim.includes("//host/p.md") || f.claim.includes("host/p.md"))).toBe(false);
    expect(d7(dir).some((f) => f.claim.includes("//host/p.md") || f.claim.includes("host/p.md"))).toBe(false);
  });
});
