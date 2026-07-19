import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";
import { consumeCalibration } from "../src/tier1/calibration/consume.js";
import type { ParsedAdr } from "../src/adr/types.js";
import type { Tier1Finding } from "../src/tier1/citations.js";
import { executeCalibrate } from "../src/cli/calibrate.js";
import { fitSeverity, wilsonLowerBound } from "../src/tier1/calibration/curve.js";
import {
  assembleCalibrationEntry,
  corpusHash,
  generateReview,
  orderReviewFindings,
  parseReview,
  ReviewParseError,
  type LabeledReviewFinding,
  type ReviewFinding,
} from "../src/tier1/calibration/review.js";
import { serializeCalibration } from "../src/tier1/calibration/schema.js";
import { deriveFindingSeverity } from "../src/tier1/calibration/severity.js";

// The calibration harness proves itself with ZERO API calls (ADR-0038). Every
// number below is computed by the harness and asserted against a hand-worked
// value or a committed golden — the chosen §2.5 floors are the only typed
// constants in the whole subsystem. The centerpiece is the honesty test: a
// perfect-point small cohort whose Wilson bound falls short keeps its channel
// closed, exactly as the founding decision demands.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "calibration", "synthetic");
const FIXED_ISO = "2026-07-10T00:00:00.000Z";
const KEY = { backend: "api", model: "claude-sonnet-5", effort: "medium" } as const;

/** Builds the labeled corpus from the committed fixture, deriving each severity from the fixture ADRs — the same path `calibrate fit` runs. */
function loadFixtureCorpus(): { labeled: LabeledReviewFinding[]; reviewFindings: ReviewFinding[]; labelByClaim: Map<string, boolean> } {
  const ctx = loadAdrLog(FIXTURE);
  const adrsByFileName = new Map<string, ParsedAdr>(ctx.adrs.map((a) => [a.fileName, a]));
  const raw = (JSON.parse(readFileSync(join(FIXTURE, "labeled-findings.json"), "utf-8")).findings as Array<
    Tier1Finding & { label: boolean }
  >);
  const labeled: LabeledReviewFinding[] = [];
  const reviewFindings: ReviewFinding[] = [];
  const labelByClaim = new Map<string, boolean>();
  raw.forEach((f, index) => {
    const severity = deriveFindingSeverity(f, adrsByFileName);
    labeled.push({ check: f.check, severity, confidence: f.reportedConfidence, label: f.label });
    reviewFindings.push({
      check: f.check,
      severity,
      confidence: f.reportedConfidence,
      claim: f.claim,
      citations: f.citations.map((c) => ({ quote: c.quote, document: c.document })),
      source: { recordingPath: "synthetic", findingIndex: index },
    });
    labelByClaim.set(f.claim, f.label);
  });
  return { labeled, reviewFindings, labelByClaim };
}

describe("Wilson score lower bound — the small-sample interval, exact", () => {
  it("matches hand-worked values", () => {
    expect(wilsonLowerBound(9, 10)).toBeCloseTo(0.5958, 4);
    expect(wilsonLowerBound(90, 100)).toBeCloseTo(0.8256, 4);
    expect(wilsonLowerBound(3, 3)).toBeCloseTo(0.4385, 4);
  });

  it("returns 0 for no evidence (n=0)", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("is always at or below the point estimate", () => {
    for (const [k, n] of [[1, 1], [5, 6], [50, 60], [99, 100]] as const) {
      expect(wilsonLowerBound(k, n)).toBeLessThanOrEqual(k / n);
    }
  });
});

describe("fitSeverity — the threshold opens on the bound, never the point", () => {
  it("KEEPS THE CHANNEL CLOSED when a perfect point rides a short bound (the honesty test)", () => {
    // 3-of-3 true at 0.9 against the 0.75 critical floor: point precision 1.0
    // clears, the Wilson lower bound 0.438 does not — so no threshold. This one
    // assertion is the founding decision made executable.
    const fit = fitSeverity(
      [
        { confidence: 0.9, label: true },
        { confidence: 0.9, label: true },
        { confidence: 0.9, label: true },
      ],
      0.75
    );
    expect(fit.pointPrecision).toBe(1);
    expect(fit.lowerBound).toBeCloseTo(0.4385, 4);
    expect(fit.threshold).toBeNull();
  });

  it("OPENS when the bound itself clears the floor", () => {
    const labeled = Array.from({ length: 20 }, () => ({ confidence: 0.9, label: true }));
    const fit = fitSeverity(labeled, 0.75);
    expect(fit.threshold).toBe(0.9);
    expect(fit.lowerBound).toBeCloseTo(0.8389, 4);
  });

  it("opens at the top slice when the wider cohort's bound falls back below the floor", () => {
    // 20 true at 0.95 clear 0.75; adding 5 false at 0.5 drags the full cohort's
    // bound under it, so the threshold is the high-confidence slice, not the low.
    const labeled = [
      ...Array.from({ length: 20 }, () => ({ confidence: 0.95, label: true })),
      ...Array.from({ length: 5 }, () => ({ confidence: 0.5, label: false })),
    ];
    const fit = fitSeverity(labeled, 0.75);
    expect(fit.threshold).toBe(0.95);
  });

  it("reports the best-observed slice, not a threshold, when nothing clears", () => {
    const fit = fitSeverity([{ confidence: 0.4, label: true }, { confidence: 0.3, label: false }], 0.95);
    expect(fit.threshold).toBeNull();
    expect(fit.lowerBound).not.toBeNull();
    expect(fit.sampleSize).toBe(2);
  });

  it("is empty and closed for an empty cohort", () => {
    const fit = fitSeverity([], 0.75);
    expect(fit.threshold).toBeNull();
    expect(fit.sampleSize).toBe(0);
    expect(fit.curve).toEqual([]);
  });
});

describe("deriveFindingSeverity — the MAX rule and its defaults", () => {
  const ctx = loadAdrLog(FIXTURE);
  const adrsByFileName = new Map<string, ParsedAdr>(ctx.adrs.map((a) => [a.fileName, a]));
  const finding = (documents: string[]): Tier1Finding => ({
    check: "S1",
    claim: "x",
    citations: documents.map((document) => ({ document, quote: "q" })),
    consequence: "y",
    reportedConfidence: 0.5,
  });

  it("takes the MAXIMUM severity among cited ADRs (critical beside routine → critical)", () => {
    expect(
      deriveFindingSeverity(finding(["0003-routine-default.md", "0001-critical-decision.md"]), adrsByFileName)
    ).toBe("critical");
  });

  it("reads a single ADR's declared severity", () => {
    expect(deriveFindingSeverity(finding(["0002-elevated-decision.md"]), adrsByFileName)).toBe("elevated");
    expect(deriveFindingSeverity(finding(["0004-cosmetic-note.md"]), adrsByFileName)).toBe("cosmetic");
  });

  it("defaults an ADR with no severity frontmatter to routine", () => {
    expect(deriveFindingSeverity(finding(["0003-routine-default.md"]), adrsByFileName)).toBe("routine");
  });

  it("defaults a finding citing NO ADR (a manifest) to routine", () => {
    expect(deriveFindingSeverity(finding(["package.json"]), adrsByFileName)).toBe("routine");
  });
});

describe("the review file round-trips through generation and strict parsing", () => {
  it("preserves every finding's severity, confidence, and label", () => {
    const { reviewFindings, labelByClaim } = loadFixtureCorpus();
    const ordered = orderReviewFindings(reviewFindings);
    // Simulate the human filling each `label: ____` slot, in the generated order.
    let k = 0;
    const filled = generateReview(reviewFindings, FIXED_ISO).replace(
      /label: ____/g,
      () => `label: ${labelByClaim.get(ordered[k++]!.claim)}`
    );
    const parsed = parseReview(filled);
    expect(parsed.length).toBe(reviewFindings.length);
    parsed.forEach((p, i) => {
      const src = ordered[i]!;
      expect(p.check).toBe(src.check);
      expect(p.severity).toBe(src.severity);
      expect(p.confidence).toBe(src.confidence);
      expect(p.label).toBe(labelByClaim.get(src.claim));
    });
  });

  it("emits one unfilled slot per finding before labeling", () => {
    const { reviewFindings } = loadFixtureCorpus();
    const review = generateReview(reviewFindings, FIXED_ISO);
    expect(review.match(/label: ____/g)?.length).toBe(reviewFindings.length);
    // An unfilled review is refused wholesale — no finding defaults into the curve.
    expect(() => parseReview(review)).toThrow(ReviewParseError);
  });
});

describe("parseReview — refusal-first (a bad label fails the whole read)", () => {
  const block = (label: string, id = 1) =>
    `## finding ${String(id).padStart(3, "0")}\ncheck: S1\nseverity: routine\nconfidence: 0.8\nclaim: c\nlabel: ${label}\n`;

  it("rejects the unfilled slot", () => {
    expect(() => parseReview(block("____"))).toThrow(/exactly "true" or "false"/);
  });
  it("rejects a blank label", () => {
    expect(() => parseReview(block(""))).toThrow(ReviewParseError);
  });
  it("rejects a case variant (TRUE)", () => {
    expect(() => parseReview(block("TRUE"))).toThrow(ReviewParseError);
  });
  it("rejects a truthy word (yes)", () => {
    expect(() => parseReview(block("yes"))).toThrow(ReviewParseError);
  });
  it("rejects a missing label line", () => {
    expect(() => parseReview("## finding 001\ncheck: S1\nseverity: routine\nconfidence: 0.8\nclaim: c\n")).toThrow(
      /no label line/
    );
  });
  it("rejects a duplicated label line", () => {
    expect(() => parseReview(`${block("true")}label: false\n`)).toThrow(/duplicate label/);
  });
  it("rejects a non-sequential finding id", () => {
    expect(() => parseReview(block("true", 2))).toThrow(/sequential/);
  });
  it("rejects a review with no findings at all", () => {
    expect(() => parseReview("# just a header, nothing to label\n")).toThrow(/no findings/);
  });
  it("accepts a clean pair of true/false", () => {
    const parsed = parseReview(`${block("true", 1)}${block("false", 2)}`);
    expect(parsed.map((p) => p.label)).toEqual([true, false]);
  });
});

describe("corpusHash — stable regardless of finding order", () => {
  it("is identical for a reordered corpus", () => {
    const { labeled } = loadFixtureCorpus();
    const reversed = [...labeled].reverse();
    expect(corpusHash(reversed)).toBe(corpusHash(labeled));
  });
});

describe("assembleCalibrationEntry — cosmetic counts but never channels", () => {
  it("counts every labeled finding in sampleSize while excluding cosmetic from perSeverity", () => {
    const { labeled } = loadFixtureCorpus();
    const entry = assembleCalibrationEntry(labeled, KEY);
    // Nine findings: one is cosmetic — in the total, absent from every channel.
    expect(entry.sampleSize).toBe(labeled.length);
    expect(Object.keys(entry.perSeverity).sort()).toEqual(["critical", "elevated", "routine"]);
    const channelled =
      entry.perSeverity.critical.sampleSize +
      entry.perSeverity.elevated.sampleSize +
      entry.perSeverity.routine.sampleSize;
    expect(channelled).toBe(labeled.length - 1); // the cosmetic finding
  });

  it("keeps a small corpus honest — every channel closed", () => {
    const { labeled } = loadFixtureCorpus();
    const entry = assembleCalibrationEntry(labeled, KEY);
    expect(entry.perSeverity.critical.threshold).toBeNull();
    expect(entry.perSeverity.elevated.threshold).toBeNull();
    expect(entry.perSeverity.routine.threshold).toBeNull();
  });
});

describe("serialization is byte-stable against the committed golden", () => {
  it("reproduces calibration.expected.json exactly", () => {
    const { labeled } = loadFixtureCorpus();
    const bytes = serializeCalibration({ schemaVersion: 1, entries: [assembleCalibrationEntry(labeled, KEY)] });
    const golden = readFileSync(join(FIXTURE, "calibration.expected.json"), "utf-8");
    expect(bytes).toBe(golden);
  });

  it("is idempotent across repeated serialization", () => {
    const { labeled } = loadFixtureCorpus();
    const once = serializeCalibration({ schemaVersion: 1, entries: [assembleCalibrationEntry(labeled, KEY)] });
    const twice = serializeCalibration({ schemaVersion: 1, entries: [assembleCalibrationEntry(labeled, KEY)] });
    expect(once).toBe(twice);
  });
});

describe("the calibrate CLI runs network-free end to end", () => {
  const S1_FIXTURE = join(__dirname, "fixtures", "tier1", "s1-contradiction");
  const S1_RECORDINGS = join(S1_FIXTURE, "recordings");
  let savedKey: string | undefined;
  let workdir: string;

  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; // prove replay needs no credential
    workdir = mkdtempSync(join(tmpdir(), "duckadrift-calibrate-"));
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it("generate replays a committed recording into a labeling review, no API key", async () => {
    const reviewPath = join(workdir, "review.md");
    const code = await executeCalibrate([
      "generate",
      S1_RECORDINGS,
      "--adr-root",
      S1_FIXTURE,
      "--out",
      reviewPath,
    ]);
    expect(code).toBe(0);
    const review = readFileSync(reviewPath, "utf-8");
    expect(review).toContain("## finding 001");
    expect(review).toContain("label: ____");
    expect(review).toMatch(/check: S1/);
  });

  it("fit reads a labeled review and writes a byte-stable calibration.json", async () => {
    // Author a tiny labeled review by hand (no generate dependency), then fit.
    const reviewPath = join(workdir, "labeled.md");
    const outPath = join(workdir, "calibration.json");
    writeFileSync(
      reviewPath,
      "# review\n\n## finding 001\ncheck: S1\nseverity: critical\nconfidence: 0.9\nclaim: c\nlabel: true\n\n" +
        "## finding 002\ncheck: S1\nseverity: critical\nconfidence: 0.9\nclaim: d\nlabel: true\n",
      "utf-8"
    );
    const code = await executeCalibrate([
      "fit",
      reviewPath,
      "--key",
      "backend=api,model=claude-sonnet-5,effort=medium",
      "--out",
      outPath,
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    // Two-of-two critical: point clears, bound does not → closed, still honest.
    expect(parsed.entries[0].perSeverity.critical.threshold).toBeNull();
  });

  it("fit unions multiple --review files under one corpusHash (M4.3)", async () => {
    // The two-sided corpus: file A (as if public), file B (as if private).
    const a = join(workdir, "a.md");
    const b = join(workdir, "b.md");
    const outPath = join(workdir, "cal.json");
    writeFileSync(a, "## finding 001\ncheck: S3\nseverity: routine\nconfidence: 0.9\nclaim: pa\nlabel: true\n", "utf-8");
    writeFileSync(b, "## finding 001\ncheck: S3\nseverity: routine\nconfidence: 0.7\nclaim: pb\nlabel: false\n", "utf-8");
    const code = await executeCalibrate([
      "fit", a, "--review", b,
      "--key", "backend=api,model=claude-sonnet-5,effort=high",
      "--out", outPath,
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(parsed.entries[0].sampleSize).toBe(2); // both files' findings, one entry
    // The union hash equals corpusHash over the concatenated labeled sets —
    // order-independent, so (A,B) and (B,A) agree.
    const union = [
      { check: "S3", severity: "routine" as const, confidence: 0.9, label: true },
      { check: "S3", severity: "routine" as const, confidence: 0.7, label: false },
    ];
    expect(parsed.entries[0].corpusHash).toBe(corpusHash(union));
    expect(corpusHash([...union].reverse())).toBe(corpusHash(union));
  });

  it("fit refuses the WHOLE fit when the second file is malformed (M4.3)", async () => {
    const a = join(workdir, "good.md");
    const b = join(workdir, "bad.md");
    const outPath = join(workdir, "never.json");
    writeFileSync(a, "## finding 001\ncheck: S3\nseverity: routine\nconfidence: 0.9\nclaim: ok\nlabel: true\n", "utf-8");
    writeFileSync(b, "## finding 001\ncheck: S3\nseverity: routine\nconfidence: 0.7\nclaim: bad\nlabel: ____\n", "utf-8");
    const code = await executeCalibrate([
      "fit", a, "--review", b,
      "--key", "backend=api,model=claude-sonnet-5,effort=high",
      "--out", outPath,
    ]);
    expect(code).toBe(1);
    expect(existsSync(outPath)).toBe(false); // nothing written — no partial corpus
  });

  it("multi-review fit output is byte-stable across two runs on the same inputs", async () => {
    const a = join(workdir, "s1.md");
    const b = join(workdir, "s2.md");
    writeFileSync(a, "## finding 001\ncheck: S1\nseverity: critical\nconfidence: 0.9\nclaim: x\nlabel: true\n", "utf-8");
    writeFileSync(b, "## finding 001\ncheck: S3\nseverity: routine\nconfidence: 0.8\nclaim: y\nlabel: false\n", "utf-8");
    const o1 = join(workdir, "c1.json");
    const o2 = join(workdir, "c2.json");
    for (const o of [o1, o2]) {
      const code = await executeCalibrate([
        "fit", a, "--review", b,
        "--key", "backend=api,model=claude-sonnet-5,effort=high",
        "--out", o,
      ]);
      expect(code).toBe(0);
    }
    // Raw byte-identity — no timestamp exists to strip (M4.3 verifier
    // pre-check: a committed artifact must not diff on every re-fit).
    expect(readFileSync(o1, "utf-8")).toBe(readFileSync(o2, "utf-8"));
  });

  it("generateReview emits preamble and repo/source display lines the parser ignores (M4.3)", () => {
    const md = generateReview(
      [{
        check: "S3", severity: "routine", confidence: 0.8, claim: "c",
        citations: [{ quote: "q", document: "package.json" }],
        source: { recordingPath: "r", findingIndex: 0 },
        repo: "first-internal-log", sourceKind: "diff abc123def456",
      }],
      FIXED_ISO,
      { preamble: "## Labeling rubric\n\n- rule one" }
    );
    expect(md).toContain("## Labeling rubric");
    expect(md).toContain("repo: first-internal-log");
    expect(md).toContain("source: diff abc123def456");
    // The parser reads through the display lines and still refuses the unfilled slot.
    expect(() => parseReview(md)).toThrow(ReviewParseError);
    const labeled = parseReview(md.replace("label: ____", "label: true"));
    expect(labeled).toEqual([{ check: "S3", severity: "routine", confidence: 0.8, label: true }]);
  });

  it("fit rejects a review with an unfilled label (exit 1)", async () => {
    const reviewPath = join(workdir, "unfilled.md");
    writeFileSync(reviewPath, "## finding 001\ncheck: S1\nseverity: routine\nconfidence: 0.8\nclaim: c\nlabel: ____\n", "utf-8");
    const code = await executeCalibrate([
      "fit",
      reviewPath,
      "--key",
      "backend=api,model=claude-sonnet-5,effort=medium",
      "--out",
      join(workdir, "out.json"),
    ]);
    expect(code).toBe(1);
  });
});

describe("consumeCalibration: a repo-local override may only tighten, never open (ADR-0049)", () => {
  const CONSUME_KEY = { backend: "api", model: "claude-sonnet-5", effort: "high" };
  const closed = (floor: number) => ({ floor, threshold: null, sampleSize: 0, pointPrecision: null, lowerBound: null, curve: [] as unknown[] });
  // A genuine-looking OPEN routine channel at threshold t: a 73/73 cohort whose
  // recomputed Wilson bound (>= 0.95) clears the floor, so deriveChannelState opens it.
  const openRoutineAt = (t: number) => {
    const lb = wilsonLowerBound(73, 73);
    return { floor: 0.95, threshold: t, sampleSize: 73, pointPrecision: 1, lowerBound: lb, curve: [{ confidence: t, n: 73, truePositives: 73, precision: 1, wilsonLower: lb }] };
  };
  const entry = (routine: unknown) => ({ corpusHash: "synthetic", sampleSize: 73, key: CONSUME_KEY, perSeverity: { critical: closed(0.75), elevated: closed(0.9), routine } });
  const writeCal = (dir: string, name: string, routine: unknown) =>
    writeFileSync(join(dir, name), JSON.stringify({ schemaVersion: 1, entries: [entry(routine)] }), "utf-8");
  const withDir = (fn: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "duckadrift-cal-override-"));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("promoted attack 6: a repo-local entry that omits a severity is uncalibrated-loud, never a thrown crash (Fix 1)", () => {
    withDir((dir) => {
      writeFileSync(
        join(dir, "calibration.json"),
        JSON.stringify({ schemaVersion: 1, entries: [{ corpusHash: "attacker", sampleSize: 0, key: CONSUME_KEY, perSeverity: { critical: closed(0.75), elevated: closed(0.9) } }] }),
        "utf-8"
      );
      let consumption: ReturnType<typeof consumeCalibration> | undefined;
      expect(() => {
        consumption = consumeCalibration(dir, CONSUME_KEY);
      }).not.toThrow();
      expect(consumption!.calibrated).toBe(false);
    });
  });

  it("promoted attack 5 (coercion): a string threshold is rejected at read, not coerced: uncalibrated-loud (Fix 1)", () => {
    withDir((dir) => {
      const lb = wilsonLowerBound(73, 73);
      writeFileSync(
        join(dir, "calibration.json"),
        JSON.stringify({
          schemaVersion: 1,
          entries: [{
            corpusHash: "attacker", sampleSize: 73, key: CONSUME_KEY,
            perSeverity: {
              critical: closed(0.75), elevated: closed(0.9),
              routine: { floor: 0.95, threshold: "0", sampleSize: 73, pointPrecision: 1, lowerBound: lb, curve: [{ confidence: "0", n: 73, truePositives: 73, precision: 1, wilsonLower: lb }] },
            },
          }],
        }),
        "utf-8"
      );
      expect(consumeCalibration(dir, CONSUME_KEY).calibrated).toBe(false);
    });
  });

  it("ADDED: a WELL-FORMED numeric fabricated override that clears the floor still opens nothing: the stricter-only guard (Fix 2)", () => {
    // The Stage 0 red used only the string-coercion vector, which Fix 1 alone
    // closes. This case is numeric, self-consistent, and clears 0.95, so
    // validation passes it; Fix 2 is what closes it: the shipped baseline leaves
    // routine closed, so a repo-local override cannot open it. Without this
    // assertion the stricter-only policy would be untested and could regress.
    withDir((dir) => {
      writeCal(dir, "calibration.json", openRoutineAt(0.9)); // valid, numeric, clears the floor
      const consumption = consumeCalibration(dir, CONSUME_KEY); // default shipped: api routine CLOSED
      expect(consumption.calibrated).toBe(true);
      if (!consumption.calibrated) return;
      expect(consumption.perSeverity.routine.state).toBe("closed"); // the override could NOT open it
      expect(consumption.source).toBe("repo-local-override");
      expect(consumption.overrideRefusals?.some((r) => r.severity === "routine")).toBe(true); // refused loudly
    });
  });

  it("tightening IS allowed: an override that CLOSES an open shipped channel takes effect, with no refusal", () => {
    withDir((dir) => {
      writeCal(dir, "shipped.json", openRoutineAt(0.9)); // shipped baseline: routine OPEN
      writeCal(dir, "calibration.json", closed(0.95)); // override: routine CLOSED (tightens)
      const consumption = consumeCalibration(dir, CONSUME_KEY, join(dir, "shipped.json"));
      expect(consumption.calibrated).toBe(true);
      if (!consumption.calibrated) return;
      expect(consumption.perSeverity.routine.state).toBe("closed");
      expect(consumption.overrideRefusals ?? []).toHaveLength(0);
    });
  });

  it("lowering is refused: an override that LOWERS a shipped threshold is refused, and the shipped value stands", () => {
    withDir((dir) => {
      writeCal(dir, "shipped.json", openRoutineAt(0.9)); // shipped baseline: routine OPEN at 0.9
      writeCal(dir, "calibration.json", openRoutineAt(0.8)); // override: OPEN at 0.8 (would lower)
      const consumption = consumeCalibration(dir, CONSUME_KEY, join(dir, "shipped.json"));
      expect(consumption.calibrated).toBe(true);
      if (!consumption.calibrated) return;
      const routine = consumption.perSeverity.routine;
      expect(routine.state).toBe("open");
      if (routine.state === "open") expect(routine.threshold).toBe(0.9); // shipped stood
      expect(consumption.overrideRefusals?.some((r) => r.severity === "routine")).toBe(true);
    });
  });
});
