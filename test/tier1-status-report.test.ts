import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import type { AdrLogContext } from "../src/adr/types.js";
import type { Tier1Config } from "../src/config/load.js";
import { buildErrorReport, buildJsonReport, renderMarkdownReport } from "../src/report/write.js";
import type { Tier1Status } from "../src/report/write.js";
import { tier1CredentialsPresent } from "../src/tier1/credentials.js";
import { resolveTier1Status } from "../src/tier1/gate.js";
import { loadFixtureContext } from "./helpers/run-checks.js";

// The Tier 1 status vocabulary and its report block (ADR-0029 Part 5):
// disabled / no-credentials / no-signal / eligible, resolved deterministically
// and rendered honestly. Skipping is always spoken.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER1_FIXTURES = join(__dirname, "fixtures", "tier1");

const ENABLED: Tier1Config = { enabled: true, backend: "api", model: "claude-sonnet-5", effort: "high" };
const DISABLED: Tier1Config = { ...ENABLED, enabled: false };

// A secret-shaped value used ONLY to prove it never reaches any report surface.
const FAKE_KEY = "sk-ant-test-never-in-reports-0123";

function s2Context(): AdrLogContext {
  return loadFixtureContext(join(TIER1_FIXTURES, "s2-code-vs-decision"));
}

function noSignalContext(): AdrLogContext {
  const base = loadAdrLog(join(TIER1_FIXTURES, "clean-baseline"));
  return { ...base, prContext: { changedFiles: ["README.md"] } };
}

function scheduleContext(): AdrLogContext {
  return loadAdrLog(join(TIER1_FIXTURES, "clean-baseline")); // prContext: null
}

describe("Tier 1 status resolution (deterministic order)", () => {
  it("not enabled → { enabled: false }, regardless of everything else", () => {
    expect(resolveTier1Status(DISABLED, true, s2Context())).toEqual({ enabled: false });
  });

  it("precedence: enabled + no credentials + signal-bearing pr-context → no-credentials WITH signals", () => {
    const status = resolveTier1Status(ENABLED, false, s2Context());
    expect(status).toEqual({
      enabled: true,
      status: "no-credentials",
      signals: [
        {
          kind: "governed-path",
          adr: "0001-outbound-http-via-retry-wrapper.md",
          files: ["src/net/client.ts"],
        },
      ],
    });
  });

  it("enabled + credentials + no-signal diff → no-signal", () => {
    expect(resolveTier1Status(ENABLED, true, noSignalContext())).toEqual({
      enabled: true,
      status: "no-signal",
      signals: [],
    });
  });

  it("enabled + credentials + signal-bearing diff → eligible with the signals", () => {
    const status = resolveTier1Status(ENABLED, true, s2Context());
    expect(status.enabled).toBe(true);
    if (status.enabled) {
      expect(status.status).toBe("eligible");
      expect(status.signals).toHaveLength(1);
    }
  });

  it("schedule mode (no pr-context) + enabled + credentials → eligible with empty signals; the gate is not consulted", () => {
    // relevanceGate throws without a pr-context, so a non-throwing "eligible"
    // with [] is itself the proof the resolver never consulted it.
    expect(resolveTier1Status(ENABLED, true, scheduleContext())).toEqual({
      enabled: true,
      status: "eligible",
      signals: [],
    });
  });
});

describe("Tier 1 markdown block (each status renders its exact copy)", () => {
  it("disabled", () => {
    const md = renderMarkdownReport([], [], { enabled: false });
    expect(md).toContain("## Tier 1");
    expect(md).toContain("Tier 1 semantic checks are disabled (tier1.enabled is not set).");
  });

  it("no-credentials, with the fork-PR doctrine named and signals still listed", () => {
    const status = resolveTier1Status(ENABLED, false, s2Context());
    const md = renderMarkdownReport([], [], status);
    expect(md).toContain(
      "Tier 1 is enabled, but ANTHROPIC_API_KEY is not present in the environment — semantic checks skipped; Tier 0 coverage only. Fork-triggered PRs never receive secrets; the absence is expected there."
    );
    expect(md).toContain(
      "- governed-path: `0001-outbound-http-via-retry-wrapper.md` governs `src/net/client.ts`"
    );
  });

  it("no-signal (ADR-0003's exact contract)", () => {
    const md = renderMarkdownReport([], [], resolveTier1Status(ENABLED, true, noSignalContext()));
    expect(md).toContain(
      "Tier 1 skipped: no signal — the diff touches no governed path and trips no architectural signal. Zero API calls made."
    );
  });

  it("eligible without a run attached, honest about where checks execute, one line per signal", () => {
    const md = renderMarkdownReport([], [], resolveTier1Status(ENABLED, true, s2Context()));
    expect(md).toContain(
      "Tier 1 eligible: 1 signal(s) detected. Semantic checks run under the report command; this output carries none."
    );
    expect(md).toContain(
      "- governed-path: `0001-outbound-http-via-retry-wrapper.md` governs `src/net/client.ts`"
    );
  });

  it("the M1-era surfaces are gone: no 'not run (M1 scope)' line, no calibration placeholder", () => {
    const md = renderMarkdownReport([], [], { enabled: false });
    expect(md).not.toContain("not run (M1 scope)");
    expect(md).not.toContain("## Calibration status");
  });
});

describe("Tier 1 JSON shape", () => {
  it("each status lands verbatim in JsonReport.tier1", () => {
    const statuses: Tier1Status[] = [
      { enabled: false },
      { enabled: true, status: "no-credentials", signals: [] },
      { enabled: true, status: "no-signal", signals: [] },
      { enabled: true, status: "eligible", signals: [{ kind: "dependency-manifest", files: ["go.mod"] }] },
    ];
    for (const status of statuses) {
      expect(buildJsonReport([], "docs/adr", [], status).tier1).toEqual(status);
    }
  });

  it("the error report keeps tier1: null — an aborted scan never fabricates a status", () => {
    const { json, markdown } = buildErrorReport("boom");
    expect(json.tier1).toBeNull();
    expect(markdown).toContain("Tier 1: unresolved — the scan aborted before Tier 1 status resolution");
  });
});

describe("credentials: presence is the only fact the system may know (PDR §2.8)", () => {
  it("present and non-empty → true", () => {
    expect(tier1CredentialsPresent({ ANTHROPIC_API_KEY: FAKE_KEY })).toBe(true);
  });

  it("unset → false", () => {
    expect(tier1CredentialsPresent({})).toBe(false);
  });

  it("empty string → false", () => {
    expect(tier1CredentialsPresent({ ANTHROPIC_API_KEY: "" })).toBe(false);
  });

  it("whitespace-only → false (PR #32's logged non-blocker, landed with M3.2)", () => {
    expect(tier1CredentialsPresent({ ANTHROPIC_API_KEY: "   \t " })).toBe(false);
  });

  it("the key's value appears in no report string, markdown or JSON", () => {
    const present = tier1CredentialsPresent({ ANTHROPIC_API_KEY: FAKE_KEY });
    const status = resolveTier1Status(ENABLED, present, s2Context());
    const md = renderMarkdownReport([], [], status);
    const json = JSON.stringify(buildJsonReport([], "docs/adr", [], status));
    expect(md).not.toContain(FAKE_KEY);
    expect(json).not.toContain(FAKE_KEY);
  });
});
