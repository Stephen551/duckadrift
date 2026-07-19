import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CalibrationConsumption } from "../src/tier1/calibration/consume.js";
import { consumeCalibration } from "../src/tier1/calibration/consume.js";
import { routeFindings } from "../src/tier1/calibration/route.js";
import type { Tier1CheckId } from "../src/tier1/checks.js";

// The security-hardening red corpus (ADR-0046). Subversions a cross-vendor
// adversarial pass reproduced against this tree, each written as an assertion
// of the SECURE behavior the milestone has not built yet. Every test here fails
// on purpose against the current code. The file is named `*.redtest.ts`, which
// the gate config does not match, so `npm test` stays green; run these with
// `npx vitest run --config vitest.redcorpus.config.ts`.
//
// Attacks 1 and 2 (checkpoint) were closed by ADR-0047 and promoted into
// test/tier1-sweep.test.ts; attacks 3 and 4 (transport binary and scratch) were
// closed by ADR-0048 and promoted into test/tier1-claude-code-transport.test.ts.
// The two here remain red: calibration coercion (5) and crash (6). Each later
// stage promotes its describe into the sibling `*.test.ts` that owns the seam,
// where it turns green once the fix lands. No fix belongs in this file.

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
