import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CalibrationConsumption } from "../src/tier1/calibration/consume.js";
import { consumeCalibration } from "../src/tier1/calibration/consume.js";
import { routeFindings } from "../src/tier1/calibration/route.js";
import type { Tier1CheckId } from "../src/tier1/checks.js";
import { claudeCodeTransport } from "../src/tier1/transport.js";

// The security-hardening red corpus (ADR-0046). Subversions a cross-vendor
// adversarial pass reproduced against this tree, each written as an assertion
// of the SECURE behavior the milestone has not built yet. Every test here fails
// on purpose against the current code. The file is named `*.redtest.ts`, which
// the gate config does not match, so `npm test` stays green; run these with
// `npx vitest run --config vitest.redcorpus.config.ts`.
//
// Attacks 1 and 2 (checkpoint suppression and fabrication) were closed by
// ADR-0047 and promoted into test/tier1-sweep.test.ts, where they now pass. The
// four here remain red: transport binary/scratch (3, 4) and calibration
// coercion/crash (5, 6). Each later stage promotes its describe into the sibling
// `*.test.ts` that owns the seam, where it turns green once the fix lands. No
// fix belongs in this file.

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Transport attacks (3, 4): the model binary and its scratch dir must not
// resolve through inputs the scanned repo controls. The fakes live under
// fixtures/claude-code-fake; both scenarios emit a success envelope so the
// current code takes its normal path.
// ---------------------------------------------------------------------------

const FAKE_ROOT = join(__dirname, "fixtures", "claude-code-fake");
const PATH_SENTINEL = "PATH_HIJACK_SENTINEL_8f2a1c";

/** An env whose PATH resolves `claude` to the named fake, real PATH behind it so node resolves. */
function fakeEnv(scenario: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
    PATH: `${join(FAKE_ROOT, scenario)}${delimiter}${process.env.PATH ?? ""}`,
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-redcorpus-token-never-real",
  };
}

/** The realized request surface: system blocks, forced-tool schema, and a user message. */
function ccRequest(model = "claude-sonnet-5"): object {
  return {
    model,
    max_tokens: 1024,
    output_config: { effort: "high" },
    system: [{ type: "text", text: "You are the red-corpus probe." }],
    tools: [
      {
        name: "report_findings",
        input_schema: { type: "object", properties: { findings: { type: "array" } }, required: ["findings"] },
      },
    ],
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  };
}

describe("ADR-0046 attack 3: PATH-planted claude binary (the model binary is untrusted input)", () => {
  it("a claude planted earlier on PATH must not run; the tool resolves its binary from a trusted location", async () => {
    const transport = claudeCodeTransport({ deadlineSeconds: 60, env: fakeEnv("path-hijack") });
    let observed = "";
    try {
      observed = JSON.stringify(await transport.send(ccRequest()));
    } catch (err) {
      observed = String(err instanceof Error ? err.message : err);
    }
    // Secure (ADR-0046): the planted binary never runs, so its sentinel never
    // reaches the result. Today execFile("claude") resolves the PATH fake and
    // returns its forged finding.
    expect(observed).not.toContain(PATH_SENTINEL);
  });
});

describe("ADR-0046 attack 4: TMPDIR scratch redirect (the temp-dir environment is untrusted input)", () => {
  it("the per-send scratch dir resolves outside the scanned repo even when the temp-dir env points inside it", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "duckadrift-redcorpus-repo-"));
    const evilTmp = join(repoRoot, ".evil-tmp");
    mkdirSync(evilTmp, { recursive: true });
    const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    try {
      // A repo that can set the run's temp-dir env points it under its own root.
      process.env.TMPDIR = evilTmp;
      process.env.TEMP = evilTmp;
      process.env.TMP = evilTmp;
      const transport = claudeCodeTransport({ deadlineSeconds: 60, env: fakeEnv("cwd-echo") });
      const result = await transport.send(ccRequest());
      const findings = ((result.response as Record<string, unknown>).content as Array<Record<string, unknown>>)[0]!
        .input as { findings: Array<{ observedCwd: string }> };
      const observedCwd = findings.findings[0]!.observedCwd;

      // Secure (ADR-0046): the scratch dir (the child's cwd, carrying the
      // system-prompt file) resolves outside the scanned repo, so the repo's
      // CLAUDE.md cannot bleed into a check prompt. Today os.tmpdir() honors the
      // redirected env and the scratch lands under the repo.
      expect(resolve(observedCwd).startsWith(resolve(repoRoot))).toBe(false);
    } finally {
      for (const k of ["TMPDIR", "TEMP", "TMP"] as const) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Calibration attacks (5, 6): a repo-local calibration.json override is
// untrusted input. It may make a channel stricter, never open one, and a
// malformed entry is uncalibrated-loud, never a crash.
// ---------------------------------------------------------------------------

const WILSON_73_73 = 0.950006246616416; // wilsonLowerBound(73, 73), exact: a fabricated cohort that clears the routine floor.

describe("ADR-0046 attack 5: calibration coercion (a repo-local override cannot open a closed channel)", () => {
  it("a string-coerced threshold does not open the routine channel, and a zero-confidence finding stays in the annex", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "duckadrift-redcorpus-cal5-"));
    try {
      const artifact = {
        schemaVersion: 1,
        entries: [
          {
            corpusHash: "attacker-supplied",
            sampleSize: 73,
            key: { backend: "api", model: "claude-sonnet-5", effort: "high" },
            perSeverity: {
              critical: { floor: 0.75, threshold: null, sampleSize: 0, pointPrecision: null, lowerBound: null, curve: [] },
              elevated: { floor: 0.9, threshold: null, sampleSize: 0, pointPrecision: null, lowerBound: null, curve: [] },
              routine: {
                floor: 0.95,
                threshold: "0",
                sampleSize: 73,
                pointPrecision: 1,
                lowerBound: WILSON_73_73,
                curve: [{ confidence: "0", n: 73, truePositives: 73, precision: 1, wilsonLower: WILSON_73_73 }],
              },
            },
          },
        ],
      };
      writeFileSync(join(repoRoot, "calibration.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");

      const consumption = consumeCalibration(repoRoot, { backend: "api", model: "claude-sonnet-5", effort: "high" });

      // Secure (ADR-0046): coerced input is uncalibrated-loud, and a repo-local
      // override may never open a channel the shipped artifact leaves closed. So
      // the routine channel is not open. Today the string threshold and string
      // confidence coerce through the comparisons and the channel opens.
      const routineOpen = consumption.calibrated && consumption.perSeverity.routine.state === "open";
      expect(routineOpen).toBe(false);

      // End to end: a zero-confidence finding must stay in the annex, never route
      // to an interrupt. Today it routes to interrupt through the opened channel.
      const finding = {
        check: "S1" as Tier1CheckId,
        claim: "zero-confidence probe",
        citations: [{ document: "x", quote: "y" }],
        consequence: "z",
        reportedConfidence: 0,
      };
      const routed = routeFindings([finding], new Map(), consumption);
      expect(routed[0]!.disposition).toBe("annex");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("ADR-0046 attack 6: calibration missing field (a malformed override is uncalibrated-loud, never a crash)", () => {
  it("a repo-local entry that omits a severity is reported uncalibrated, not raised as a TypeError", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "duckadrift-redcorpus-cal6-"));
    try {
      const artifact = {
        schemaVersion: 1,
        entries: [
          {
            corpusHash: "attacker-supplied",
            sampleSize: 0,
            key: { backend: "api", model: "claude-sonnet-5", effort: "high" },
            perSeverity: {
              critical: { floor: 0.75, threshold: null, sampleSize: 0, pointPrecision: null, lowerBound: null, curve: [] },
              elevated: { floor: 0.9, threshold: null, sampleSize: 0, pointPrecision: null, lowerBound: null, curve: [] },
              // routine deliberately omitted: the crash surface.
            },
          },
        ],
      };
      writeFileSync(join(repoRoot, "calibration.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");

      let consumption: CalibrationConsumption | undefined;
      // Secure (ADR-0046): the malformed entry is reported as uncalibrated,
      // loudly, not raised as a TypeError that crashes the whole scan. Today
      // deriveChannelState reads `threshold` off undefined and throws.
      expect(() => {
        consumption = consumeCalibration(repoRoot, { backend: "api", model: "claude-sonnet-5", effort: "high" });
      }).not.toThrow();
      expect(consumption!.calibrated).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
