import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { relevanceGate } from "../src/tier1/gate.js";
import { d5GovernedPathGate } from "../src/checks/d5-governed-path-gate.js";
import { loadAdrLog } from "../src/adr/load.js";
import { loadFixtureContext } from "./helpers/run-checks.js";
import type { AdrLogContext, PrContext } from "../src/adr/types.js";

// The deterministic relevance gate (ADR-0003, ADR-0029), proven against the
// committed M3.0 fixtures — not synthetic copies of them.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1_FIXTURES = join(__dirname, "fixtures", "tier1");
// Gate-only fixtures: tiny ADR logs for relevance-gate unit tests, outside
// test/fixtures/tier1/ so the S-check corpus's structural contract (manifest,
// recordings, S4 invariants) does not sweep them in.
const GATE_FIXTURES = join(__dirname, "fixtures", "tier1-gate");

function withPrContext(base: AdrLogContext, prContext: PrContext): AdrLogContext {
  return { ...base, prContext };
}

function cleanBaseline(): AdrLogContext {
  return loadAdrLog(join(TIER1_FIXTURES, "clean-baseline"));
}

describe("relevance gate: the committed M3.0 fixtures", () => {
  it("s2 + its committed pr-context → one governed-path signal naming the ADR and the file", () => {
    const result = relevanceGate(loadFixtureContext(join(TIER1_FIXTURES, "s2-code-vs-decision")));
    expect(result.decision).toBe("signal");
    expect(result.signals).toEqual([
      {
        kind: "governed-path",
        adr: "0001-outbound-http-via-retry-wrapper.md",
        files: ["src/net/client.ts"],
      },
    ]);
  });

  it("s3 + its committed pr-context → dependency-manifest and storage-schema signals", () => {
    const result = relevanceGate(loadFixtureContext(join(TIER1_FIXTURES, "s3-unrecorded-decision")));
    expect(result.decision).toBe("signal");
    expect(result.signals).toEqual([
      { kind: "dependency-manifest", files: ["package.json"] },
      { kind: "storage-schema", files: ["src/storage/schema.ts"] },
    ]);
  });

  it("clean-baseline + a README-only diff → no-signal, empty signals", () => {
    const ctx = withPrContext(cleanBaseline(), { changedFiles: ["README.md"] });
    expect(relevanceGate(ctx)).toEqual({ decision: "no-signal", signals: [] });
  });
});

describe("relevance gate: storage-schema rules (segment, not substring)", () => {
  const gateOn = (changedFiles: string[]) =>
    relevanceGate(withPrContext(cleanBaseline(), { changedFiles }));

  it("a .sql file signals", () => {
    const result = gateOn(["db/init.sql"]);
    expect(result.signals).toEqual([{ kind: "storage-schema", files: ["db/init.sql"] }]);
  });

  it("a file under a schemas/ directory signals", () => {
    const result = gateOn(["docs/schemas/tables.md"]);
    expect(result.signals).toEqual([{ kind: "storage-schema", files: ["docs/schemas/tables.md"] }]);
  });

  it("a schema.* basename signals", () => {
    const result = gateOn(["src/storage/schema.ts"]);
    expect(result.signals).toEqual([{ kind: "storage-schema", files: ["src/storage/schema.ts"] }]);
  });

  it("myschema.ts is NOT a signal (basename must be schema.*, not *schema*)", () => {
    expect(gateOn(["src/myschema.ts"]).decision).toBe("no-signal");
  });

  it("schema as a SUBSTRING of a segment is NOT a signal (src/schemaless/x.ts)", () => {
    expect(gateOn(["src/schemaless/x.ts"]).decision).toBe("no-signal");
  });
});

describe("relevance gate: dependency-manifest rules (exact basename)", () => {
  it("Cargo.toml at root and a nested package.json both signal", () => {
    const ctx = withPrContext(cleanBaseline(), {
      changedFiles: ["Cargo.toml", "services/api/package.json"],
    });
    const result = relevanceGate(ctx);
    expect(result.signals).toEqual([
      { kind: "dependency-manifest", files: ["Cargo.toml", "services/api/package.json"] },
    ]);
  });

  it("a near-miss basename (package.json5) is NOT a signal", () => {
    const ctx = withPrContext(cleanBaseline(), { changedFiles: ["package.json5"] });
    expect(relevanceGate(ctx).decision).toBe("no-signal");
  });
});

describe("relevance gate: no D5 exemptions imported (ADR-0029)", () => {
  it("governed-path fires even when the PR ALSO modifies the ADR — where D5 stays silent", () => {
    const base = loadAdrLog(join(TIER1_FIXTURES, "s2-code-vs-decision"));
    const ctx = withPrContext(base, {
      changedFiles: ["src/net/client.ts", "docs/adr/0001-outbound-http-via-retry-wrapper.md"],
    });
    const result = relevanceGate(ctx);
    expect(result.signals).toEqual([
      {
        kind: "governed-path",
        adr: "0001-outbound-http-via-retry-wrapper.md",
        files: ["src/net/client.ts"],
      },
    ]);
    // The contrast that proves the divergence is deliberate: D5's
    // self-modification exemption silences the check on the same context.
    expect(d5GovernedPathGate(ctx)).toEqual([]);
  });

  it("governed-path fires through an ADR-ACK marker — where D5 stays silent", () => {
    const base = loadAdrLog(join(TIER1_FIXTURES, "s2-code-vs-decision"));
    const ctx = withPrContext(base, {
      changedFiles: ["src/net/client.ts"],
      commitMessage: "probe upstream\n\nADR-ACK: 0001",
    });
    expect(relevanceGate(ctx).decision).toBe("signal");
    expect(d5GovernedPathGate(ctx)).toEqual([]);
  });
});

describe("relevance gate: status through the shared recognizer (ADR-0039)", () => {
  it("a heading-declared Accepted ADR's governed path signals", () => {
    const base = loadAdrLog(join(GATE_FIXTURES, "heading-status-governed"));
    const ctx = withPrContext(base, { changedFiles: ["src/api/routes.ts"] });
    const result = relevanceGate(ctx);
    expect(result.decision).toBe("signal");
    expect(result.signals).toEqual([
      { kind: "governed-path", adr: "0001-api-surface.md", files: ["src/api/routes.ts"] },
    ]);
  });
});

describe("relevance gate: PR-mode only contract", () => {
  it("throws when consulted without a PR context — applicability is the caller's decision", () => {
    expect(() => relevanceGate(cleanBaseline())).toThrowError(/requires a PR context/);
  });
});
