import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { code } from "../src/report/write.js";
import { runSingleCheck } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-injection");

// S3 (ADR-0013): the markdown report is piped verbatim into the job summary and
// the schedule-mode issue body. Before this, user-controlled strings (D3 link
// targets, filenames, statuses) were wrapped in single backticks with no
// escaping — a backtick inside the value closed the code span and the rest
// rendered as live markdown: autolinks, @mentions, raw HTML. code() fences the
// value so it can't break out.

describe("S3: code() keeps a user-controlled value inside its code span", () => {
  it("is identity for a value with no backticks", () => {
    expect(code("docs/adr/0001-x.md")).toBe("`docs/adr/0001-x.md`");
  });

  it("fences a value containing backticks so HTML/autolinks stay inert", () => {
    const out = code("x` <h1>PWNED</h1> `y");
    // longest backtick run in the value is 1 -> fence must be >= 2 backticks
    expect(out.startsWith("``")).toBe(true);
    expect(out.endsWith("``")).toBe(true);
    // the payload survives verbatim but inside the span (renders literally)
    expect(out).toContain("<h1>PWNED</h1>");
    // it is NOT a single-backtick span (which the payload would break out of)
    expect(out).not.toMatch(/^`[^`]/);
  });

  it("pads a leading or trailing backtick off the fence", () => {
    expect(code("`lead")).toBe("`` `lead ``");
  });
});

describe("S3: D3 fences a crafted link target in its claim", () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, "docs", "adr"), { recursive: true });
    // A dangling link whose target carries a backtick-breakout + autolink payload.
    writeFileSync(
      join(TMP, "docs", "adr", "0001-inject.md"),
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\n[x](nope`www.evil-phish.example`x.md)\n\n## Decision\ny\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("wraps the target in a multi-backtick fence, not a breakable single span", () => {
    const findings = runSingleCheck(TMP, "D3").filter((f) => f.check === "D3");
    expect(findings.length).toBe(1);
    const claim = findings[0]!.claim;
    // The target `nope`www.evil-phish.example`x.md` contains single backticks,
    // so code() fences it with a doubled backtick run. On v0.1.0 the claim used
    // single backticks and the autolink broke out.
    expect(claim).toContain("``nope`www.evil-phish.example`x.md``");
  });
});

// S3 post-audit (ADR-0013): D3's link-target sink was fenced through code() in
// the shipped release, but two sibling sinks still hand-rolled a single-backtick
// fence around a user-controlled value — D2's directory label and D6's review-by
// value. A backtick inside a directory name or a review-by string closes that
// single span and the rest renders as live markdown in the job summary and the
// scheduled-issue body. Both now route through code(). A directory name and a
// review-by value are both attacker-authorable: a fork can name an ADR
// subdirectory anything the filesystem allows (backticks included), and a
// review-by value that V8's date parser accepts can carry a trailing
// parenthesized comment full of backticks.
const D2_TMP = join(__dirname, "fixtures", ".tmp-injection-d2");
// Backticks are legal in path segments on POSIX and Windows; asterisks are not
// (Windows), so the payload uses only backticks and underscores.
const BACKTICK_DIR = "x`_INJECTED_`x";

describe("S3: D2 fences a backtick-bearing directory name in its claim", () => {
  beforeAll(() => {
    rmSync(D2_TMP, { recursive: true, force: true });
    // ADR-0001 lives in a plain subdirectory.
    mkdirSync(join(D2_TMP, "docs", "adr", "normal"), { recursive: true });
    writeFileSync(
      join(D2_TMP, "docs", "adr", "normal", "0001-base.md"),
      "---\nstatus: accepted\n---\n\n# ADR-0001\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n"
    );
    // ADR-0002 lives in a backtick-named subdirectory and declares
    // `supersedes: 1`. Under per-directory numbering (the default), no ADR-0001
    // exists in its OWN directory but one exists in `normal/` — the C2
    // cross-directory case, whose claim renders this ADR's own directory label.
    mkdirSync(join(D2_TMP, "docs", "adr", BACKTICK_DIR), { recursive: true });
    writeFileSync(
      join(D2_TMP, "docs", "adr", BACKTICK_DIR, "0002-super.md"),
      "---\nstatus: accepted\nsupersedes: 1\n---\n\n# ADR-0002\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n"
    );
  });
  afterAll(() => rmSync(D2_TMP, { recursive: true, force: true }));

  it("renders the directory name through code(), not a raw single-backtick span", () => {
    const findings = runSingleCheck(D2_TMP, "D2").filter((f) => f.check === "D2");
    // The cross-directory advisory must fire, naming this ADR's own directory.
    const crossDir = findings.find((f) => f.claim.includes("own directory"));
    expect(crossDir).toBeDefined();
    const claim = crossDir!.claim;
    // code() fences the backtick-bearing name with a doubled run (one longer
    // than the longest inner run); the shipped dirLabel used a single backtick
    // the name's own backtick broke out of. On the shipped code the claim held
    // the single-fenced form and this doubled-fence substring was absent — so
    // this assertion is red before the fix, green after.
    expect(claim).toContain(code(`${BACKTICK_DIR}/`));
  });
});

const D6_TMP = join(__dirname, "fixtures", ".tmp-injection-d6");
// A date string V8 parses as a valid PAST date (so D6 fires) whose trailing
// parenthesized comment — which V8 tolerates — carries a backtick breakout.
const REVIEW_BY = "2020-01-01 (`x`)";

describe("S3: D6 fences a backtick-bearing review-by value in its claim", () => {
  beforeAll(() => {
    rmSync(D6_TMP, { recursive: true, force: true });
    mkdirSync(join(D6_TMP, "docs", "adr"), { recursive: true });
    writeFileSync(
      join(D6_TMP, "docs", "adr", "0001-stale.md"),
      `---\nstatus: accepted\nreview-by: '${REVIEW_BY}'\n---\n\n# ADR-0001\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`
    );
  });
  afterAll(() => rmSync(D6_TMP, { recursive: true, force: true }));

  it("renders review-by through code(), not a raw single-backtick span", () => {
    const findings = runSingleCheck(D6_TMP, "D6").filter((f) => f.check === "D6");
    expect(findings.length).toBe(1);
    const claim = findings[0]!.claim;
    // Same class as D2/D3: the shipped claim wrapped `review-by: <value>` in a
    // single backtick the value's own backtick broke out of. The doubled-fence
    // form code() produces was absent on the shipped code — red before, green
    // after.
    expect(claim).toContain(code(`review-by: ${REVIEW_BY}`));
  });
});
