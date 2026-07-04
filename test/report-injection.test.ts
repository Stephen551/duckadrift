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
