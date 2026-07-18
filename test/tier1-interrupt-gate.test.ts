import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import type { ParsedAdr } from "../src/adr/types.js";
import type { Tier1Finding } from "../src/tier1/citations.js";
import { consumeCalibration, deriveChannelState } from "../src/tier1/calibration/consume.js";
import { wilsonLowerBound } from "../src/tier1/calibration/curve.js";
import { routeFindings } from "../src/tier1/calibration/route.js";
import { assembleCalibrationEntry, type LabeledReviewFinding } from "../src/tier1/calibration/review.js";
import { serializeCalibration, type CalibrationEntry } from "../src/tier1/calibration/schema.js";
import { renderMarkdownReport, withTier1Run, type Tier1Status } from "../src/report/write.js";
import type { Tier1RunResult } from "../src/tier1/runner.js";

// The interrupt gate (ADR-0042), proven in BOTH directions: the SHIPPED
// calibration opens nothing; an EARNED synthetic entry opens exactly its
// severity; a DECREED entry (threshold asserted without the bound behind it)
// is refused with the failure named. The gate re-derives the opening condition
// from the entry's own measurements at every run — the artifact is data, not
// authority.
//
// The earned-open entry is BUILT through fitSeverity via
// assembleCalibrationEntry — computed, never hand-typed, honoring the doctrine
// even in fixtures. (The M4.4 handoff's example numbers — 39-of-40 true giving
// a Wilson lower bound ≈ 0.955 — are arithmetically wrong: 39/40 gives ≈ 0.871
// and even 40/40 gives ≈ 0.912. Eighty all-true at 0.9 gives ≈ 0.9542 ≥ 0.95,
// so that is what the fixture earns its opening with. Deviation declared.)

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SHIPPED = join(REPO_ROOT, "calibration.json");
const ADR_FIXTURE = join(__dirname, "fixtures", "calibration", "synthetic");
const KEY = { backend: "api", model: "claude-sonnet-5", effort: "high" };

/** The findings fixture: one per severity, high confidence, citing the synthetic ADR log's severity-declaring records. */
function gateFindings(): { findings: Tier1Finding[]; adrsByFileName: Map<string, ParsedAdr> } {
  const ctx = loadAdrLog(ADR_FIXTURE);
  const adrsByFileName = new Map<string, ParsedAdr>(ctx.adrs.map((a) => [a.fileName, a]));
  const mk = (document: string, confidence: number, tag: string): Tier1Finding => ({
    check: "S1",
    claim: `gate fixture: ${tag}`,
    citations: [{ document, quote: "q" }],
    consequence: "c",
    reportedConfidence: confidence,
  });
  return {
    findings: [
      mk("0001-critical-decision.md", 0.99, "critical @0.99"),
      mk("0002-elevated-decision.md", 0.99, "elevated @0.99"),
      mk("0003-routine-default.md", 0.95, "routine @0.95"),
      mk("0003-routine-default.md", 0.5, "routine @0.5"),
      mk("0004-cosmetic-note.md", 0.99, "cosmetic @0.99"),
    ],
    adrsByFileName,
  };
}

/** An EARNED entry: the routine slice clears its floor because the corpus genuinely supports it — 80 true at 0.9 → Wilson LB ≈ 0.9542 ≥ 0.95 → threshold 0.9, computed by fitSeverity. */
function earnedEntry(): CalibrationEntry {
  const labeled: LabeledReviewFinding[] = [
    ...Array.from({ length: 80 }, () => ({ check: "S3", severity: "routine" as const, confidence: 0.9, label: true })),
    ...Array.from({ length: 5 }, () => ({ check: "S3", severity: "routine" as const, confidence: 0.3, label: false })),
    // elevated stays weak: two findings, one false — nothing near the 0.90 floor.
    { check: "S4", severity: "elevated" as const, confidence: 0.9, label: true },
    { check: "S4", severity: "elevated" as const, confidence: 0.9, label: false },
  ];
  return assembleCalibrationEntry(labeled, KEY as CalibrationEntry["key"]);
}

function runShape(findings: Tier1Finding[]): Tier1RunResult {
  return { findings, discarded: [], droppedCitations: [], livePremises: [], skipped: [], errors: [], usage: [] };
}

function renderWith(
  findings: Tier1Finding[],
  consumption: ReturnType<typeof consumeCalibration>,
  adrsByFileName: Map<string, ParsedAdr>
): string {
  const dispositions = routeFindings(findings, adrsByFileName, consumption);
  const base: Tier1Status = { enabled: true, status: "eligible", signals: [] };
  const tier1 = withTier1Run(base, runShape(findings), consumption, dispositions);
  return renderMarkdownReport([], [], tier1);
}

describe("two entries, one artifact: each tuple finds exactly its own (M5.4)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-"));
  const CLAUDE_CODE_KEY = { backend: "claude-code", model: "claude-sonnet-5", effort: "high" };

  it("the claude-code tuple consumes its own entry: own corpusHash, sample 15, every channel closed by data", () => {
    const consumption = consumeCalibration(tmp, CLAUDE_CODE_KEY, SHIPPED);
    expect(consumption.calibrated).toBe(true);
    if (consumption.calibrated) {
      expect(consumption.corpusHash.startsWith("e7ce85d516ea")).toBe(true);
      expect(consumption.sampleSize).toBe(15);
      for (const severity of ["critical", "elevated", "routine"] as const) {
        expect(consumption.perSeverity[severity].state).toBe("closed");
      }
    }
  });

  it("the api tuple's entry is byte-untouched beside it: same corpusHash, same sample as shipped at M4.3", () => {
    const consumption = consumeCalibration(tmp, KEY, SHIPPED);
    expect(consumption.calibrated).toBe(true);
    if (consumption.calibrated) {
      expect(consumption.corpusHash.startsWith("5e7d357ae09d")).toBe(true);
      expect(consumption.sampleSize).toBe(56);
    }
  });

  it("a mismatched tuple refuses loudly: no entry means uncalibrated, with the tuple named", () => {
    const mismatch = { backend: "claude-code", model: "claude-haiku-4-5-20251001", effort: "high" };
    const consumption = consumeCalibration(tmp, mismatch, SHIPPED);
    expect(consumption.calibrated).toBe(false);
    if (!consumption.calibrated) {
      expect(consumption.reason).toBe("no-entry");
      expect(consumption.detail).toContain("claude-haiku-4-5-20251001");
    }
  });
});

describe("closed-stays-closed — the SHIPPED artifact opens nothing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-"));

  it("every channel closed; every finding annex; zero interrupts", () => {
    const { findings, adrsByFileName } = gateFindings();
    const consumption = consumeCalibration(tmp, KEY, SHIPPED);
    expect(consumption.calibrated).toBe(true);
    if (!consumption.calibrated) return;
    expect(consumption.source).toBe("shipped");
    for (const s of ["critical", "elevated", "routine"] as const) {
      expect(consumption.perSeverity[s].state).toBe("closed");
    }
    const routed = routeFindings(findings, adrsByFileName, consumption);
    expect(routed.every((r) => r.disposition === "annex")).toBe(true);
  });

  it("the report states the three CLOSED severities with the shipped entry's real numbers", () => {
    const { findings, adrsByFileName } = gateFindings();
    const md = renderWith(findings, consumeCalibration(tmp, KEY, SHIPPED), adrsByFileName);
    expect(md).toContain("- critical: CLOSED — n=0");
    expect(md).toContain("- elevated: CLOSED — n=2, point 0.0000, lower bound 0.0000 < floor 0.9");
    expect(md).toContain("- routine: CLOSED — n=54, point 0.1556, lower bound 0.0775 < floor 0.95");
    expect(md).toContain("- cosmetic: never interrupts (PDR §2.5, hard rule)");
    expect(md).not.toContain("### Interrupts");
    // The annex still carries every finding — closed is not silent.
    expect(md).toContain("gate fixture: critical @0.99");
    expect(md).toContain("gate fixture: routine @0.95");
  });
});

describe("earned-open-opens — a legitimately-cleared floor opens exactly its severity", () => {
  const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-earned-"));
  writeFileSync(join(tmp, "calibration.json"), serializeCalibration({ schemaVersion: 1, entries: [earnedEntry()] }), "utf-8");

  it("the earned entry's routine bound genuinely clears (computed, not typed)", () => {
    const e = earnedEntry();
    expect(e.perSeverity.routine.threshold).toBe(0.9);
    expect(e.perSeverity.routine.lowerBound).toBeGreaterThanOrEqual(0.95);
    expect(e.perSeverity.elevated.threshold).toBeNull();
  });

  it("routine @0.95 interrupts; routine @0.5 stays annex; elevated/critical/cosmetic stay annex", () => {
    const { findings, adrsByFileName } = gateFindings();
    const consumption = consumeCalibration(tmp, KEY, SHIPPED);
    expect(consumption.calibrated && consumption.source).toBe("repo-local");
    const routed = routeFindings(findings, adrsByFileName, consumption);
    expect(routed.map((r) => `${r.severity}:${r.disposition}`)).toEqual([
      "critical:annex",
      "elevated:annex",
      "routine:interrupt",
      "routine:annex",
      "cosmetic:annex",
    ]);
    expect(routed[2]!.threshold).toBe(0.9);
  });

  it("the interrupt payload carries claim, evidence, consequence, and calibrated-band disposition — no raw decimals in prose", () => {
    const { findings, adrsByFileName } = gateFindings();
    const md = renderWith(findings, consumeCalibration(tmp, KEY, SHIPPED), adrsByFileName);
    expect(md).toContain("### Interrupts");
    const interruptBlock = md.slice(md.indexOf("### Interrupts"), md.indexOf("### Findings"));
    expect(interruptBlock).toContain("gate fixture: routine @0.95");
    expect(interruptBlock).toContain("Quoted from");
    expect(interruptBlock).toContain("Consequence:");
    expect(interruptBlock).toContain(
      "Disposition: interrupt — reported confidence at or above the calibrated threshold for routine findings."
    );
    // The finding's raw confidence decimal never appears in the disposition prose.
    expect(interruptBlock).not.toMatch(/confidence 0\.\d/);
    // Interrupt is a push, not a relocation: the same finding is in the annex too.
    const annexBlock = md.slice(md.indexOf("### Findings"));
    expect(annexBlock).toContain("gate fixture: routine @0.95");
    expect(annexBlock).toContain("interrupted above (channel open)");
    // Cosmetic stays annex even at confidence 0.99 with routine open.
    expect(annexBlock).toContain("gate fixture: cosmetic @0.99");
  });

  it("the report names the repo-local artifact (local-override)", () => {
    const { findings, adrsByFileName } = gateFindings();
    const md = renderWith(findings, consumeCalibration(tmp, KEY, SHIPPED), adrsByFileName);
    expect(md).toContain("Artifact: repo-local");
    expect(md).toContain("- routine: OPEN — threshold 0.9000");
  });
});

describe("decreed-open-refused — the gate recomputes from the curve; no summary field is trusted", () => {
  it("a gutted stored bound refuses on MISMATCH even though the true measurement would open — integrity failed", () => {
    const decreed = earnedEntry();
    // The attack: assert routine's threshold but gut the stored bound.
    decreed.perSeverity.routine.lowerBound = 0.6;
    const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-decreed-"));
    writeFileSync(join(tmp, "calibration.json"), serializeCalibration({ schemaVersion: 1, entries: [decreed] }), "utf-8");
    const consumption = consumeCalibration(tmp, KEY, SHIPPED);
    expect(consumption.calibrated).toBe(true);
    if (!consumption.calibrated) return;
    const routine = consumption.perSeverity.routine;
    expect(routine.state).toBe("closed");
    if (routine.state !== "closed") return;
    expect(routine.refusedDecree?.assertedThreshold).toBe(0.9);
    expect(routine.refusedDecree?.lowerBound).toBe(0.6);
    expect(routine.refusedDecree?.recomputedLowerBound).toBeGreaterThanOrEqual(0.95);
    expect(routine.refusedDecree?.reason).toContain("disagrees with the bound recomputed from the curve");
    // No finding interrupts through a refused decree.
    const { findings, adrsByFileName } = gateFindings();
    const routed = routeFindings(findings, adrsByFileName, consumption);
    expect(routed.every((r) => r.disposition === "annex")).toBe(true);
    const md = renderWith(findings, consumption, adrsByFileName);
    expect(md).toContain("REFUSED: stored lowerBound 0.6000 disagrees");
  });

  it("the TWO-FIELD forgery (the verifier's defeat): threshold + lowerBound both edited on the shipped routine entry → refused, recomputed bound named", () => {
    const shipped = JSON.parse(readFileSync(SHIPPED, "utf-8"));
    const forged = structuredClone(shipped.entries.find((e: CalibrationEntry) => e.key.model === "claude-sonnet-5"));
    // The verifier's reproduction: forge the threshold at the curve's BEST
    // slice (the highest recomputable bound the corpus offers — 0.0775) and
    // assert a wishful stored bound beside it. Even the corpus's best real
    // number is nowhere near the floor, and the gate says so.
    const routineCurve = forged.perSeverity.routine.curve;
    const widest = routineCurve.reduce((a: { wilsonLower: number }, p: { wilsonLower: number }) =>
      p.wilsonLower > a.wilsonLower ? p : a
    );
    forged.perSeverity.routine.threshold = widest.confidence;
    forged.perSeverity.routine.lowerBound = 0.99;
    const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-forgery-"));
    writeFileSync(join(tmp, "calibration.json"), serializeCalibration({ schemaVersion: 1, entries: [forged] }), "utf-8");
    const consumption = consumeCalibration(tmp, KEY, SHIPPED);
    expect(consumption.calibrated).toBe(true);
    if (!consumption.calibrated) return;
    const routine = consumption.perSeverity.routine;
    expect(routine.state).toBe("closed");
    if (routine.state !== "closed") return;
    const expected = wilsonLowerBound(widest.truePositives, widest.n);
    expect(routine.refusedDecree?.recomputedLowerBound).toBeCloseTo(expected, 9);
    expect(expected).toBeCloseTo(0.0775, 3); // the shipped corpus's real bound at its widest slice
    expect(routine.refusedDecree?.reason).toContain("does not meet floor 0.95");
    expect(routine.refusedDecree?.reason).toContain("stored lowerBound was 0.9900");
  });

  it("a threshold with NO curve point behind it is refused — thresholds are curve crossings", () => {
    const shipped = JSON.parse(readFileSync(SHIPPED, "utf-8"));
    const forged = structuredClone(shipped.entries.find((e: CalibrationEntry) => e.key.model === "claude-sonnet-5"));
    forged.perSeverity.routine.threshold = 0.42424242; // no such confidence in the curve
    forged.perSeverity.routine.lowerBound = 0.99;
    const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-nopoint-"));
    writeFileSync(join(tmp, "calibration.json"), serializeCalibration({ schemaVersion: 1, entries: [forged] }), "utf-8");
    const consumption = consumeCalibration(tmp, KEY, SHIPPED);
    expect(consumption.calibrated).toBe(true);
    if (!consumption.calibrated) return;
    const routine = consumption.perSeverity.routine;
    expect(routine.state).toBe("closed");
    if (routine.state !== "closed") return;
    expect(routine.refusedDecree?.reason).toBe("threshold has no curve support");
    expect(routine.refusedDecree?.recomputedLowerBound).toBeNull();
  });

  it("a fully SELF-CONSISTENT fabricated curve opens — by design, that is the review boundary's job (corpusHash + re-fit), not this gate's", () => {
    // 198-of-200 at 0.9: recomputed Wilson LB ≈ 0.9634 ≥ 0.95, stored bound
    // matching the recomputation exactly. The gate cannot distinguish this
    // from an earned artifact; the labeling review + hash chain can.
    const lb = wilsonLowerBound(198, 200);
    expect(lb).toBeGreaterThanOrEqual(0.95);
    const cal = {
      floor: 0.95,
      threshold: 0.9,
      sampleSize: 200,
      pointPrecision: 0.99,
      lowerBound: lb,
      curve: [{ confidence: 0.9, n: 200, truePositives: 198, precision: 0.99, wilsonLower: lb }],
    };
    expect(deriveChannelState(cal, "routine").state).toBe("open");
  });

  it("a recomputed bound exactly AT the floor opens (>= is the spec); one member fewer refuses", () => {
    // 73 all-true at 0.9: recomputed LB = 1/(1 + z²/73) ≈ 0.95001 ≥ 0.95 → open.
    const at = wilsonLowerBound(73, 73);
    expect(at).toBeGreaterThanOrEqual(0.95);
    const open = deriveChannelState(
      { floor: 0.95, threshold: 0.9, sampleSize: 73, pointPrecision: 1, lowerBound: at, curve: [{ confidence: 0.9, n: 73, truePositives: 73, precision: 1, wilsonLower: at }] },
      "routine"
    );
    expect(open.state).toBe("open");
    // 72 all-true: recomputed ≈ 0.94934 < 0.95 → refused with the recomputation named.
    const under = wilsonLowerBound(72, 72);
    expect(under).toBeLessThan(0.95);
    const closed = deriveChannelState(
      { floor: 0.95, threshold: 0.9, sampleSize: 72, pointPrecision: 1, lowerBound: under, curve: [{ confidence: 0.9, n: 72, truePositives: 72, precision: 1, wilsonLower: under }] },
      "routine"
    );
    expect(closed.state).toBe("closed");
    if (closed.state === "closed") {
      expect(closed.refusedDecree?.recomputedLowerBound).toBeCloseTo(under, 9);
      expect(closed.refusedDecree?.reason).toContain("does not meet floor 0.95");
    }
  });

  it("an entry that lowered its own floor field cannot open by decree — the §2.5 constant governs", () => {
    // floor: 0.5 typed into the artifact with a self-consistent curve whose
    // bound (≈0.6) clears THAT — but the gate re-checks against the real 0.95.
    const lb = wilsonLowerBound(7, 10);
    const tampered = {
      floor: 0.5,
      threshold: 0.9,
      sampleSize: 10,
      pointPrecision: 0.7,
      lowerBound: lb,
      curve: [{ confidence: 0.9, n: 10, truePositives: 7, precision: 0.7, wilsonLower: lb }],
    };
    const state = deriveChannelState(tampered, "routine");
    expect(state.state).toBe("closed");
    if (state.state === "closed") expect(state.refusedDecree?.floor).toBe(0.95);
  });
});

describe("tuple-mismatch — a run no entry answers is UNCALIBRATED, loud", () => {
  it("names the missing tuple", () => {
    const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-tuple-"));
    const consumption = consumeCalibration(tmp, { backend: "api", model: "claude-haiku-4-5", effort: "high" }, SHIPPED);
    expect(consumption.calibrated).toBe(false);
    if (consumption.calibrated) return;
    expect(consumption.reason).toBe("no-entry");
    expect(consumption.detail).toContain("claude-haiku-4-5");
    const { findings, adrsByFileName } = gateFindings();
    const routed = routeFindings(findings, adrsByFileName, consumption);
    expect(routed.every((r) => r.disposition === "annex")).toBe(true);
    const md = renderWith(findings, consumption, adrsByFileName);
    expect(md).toContain("UNCALIBRATED (no-entry)");
  });

  it("an unreadable repo-local artifact is a named uncalibrated state, never a silent fall-through", () => {
    const tmp = mkdtempSync(join(tmpdir(), "duckadrift-gate-unreadable-"));
    writeFileSync(join(tmp, "calibration.json"), "{ not json", "utf-8");
    const consumption = consumeCalibration(tmp, KEY, SHIPPED);
    expect(consumption.calibrated).toBe(false);
    if (consumption.calibrated) return;
    expect(consumption.reason).toBe("unreadable");
    expect(consumption.detail).toContain("repo-local");
  });
});

describe("the action-layer repro — zero interrupt posts under the shipped artifact", () => {
  it("emit-interrupts posts nothing, proven with gh absent from PATH", async () => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [join(REPO_ROOT, "test", "action", "interrupt-gate-repro.mjs")], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    });
    expect(result.stderr || "").toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("REPRO PASSED");
  }, 30_000);
});

describe("the shipped artifact itself (the load-bearing constant of this milestone)", () => {
  it("carries the M4.3 entry and opens nothing", () => {
    const shipped = JSON.parse(readFileSync(SHIPPED, "utf-8"));
    const entry = shipped.entries.find(
      (e: CalibrationEntry) => e.key.model === "claude-sonnet-5" && e.key.effort === "high"
    );
    expect(entry).toBeDefined();
    for (const s of ["critical", "elevated", "routine"] as const) {
      expect(deriveChannelState(entry.perSeverity[s], s).state).toBe("closed");
    }
  });
});
