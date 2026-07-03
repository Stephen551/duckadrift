import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixtureContext } from "./helpers/run-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER0_DIR = join(__dirname, "fixtures", "tier0");

// ADR-0007: ADR discovery recurses under the ADR root, and any markdown
// file found there that isn't recognized as an ADR or the index is always
// surfaced (never silently dropped), regardless of whether it turns out to
// be legitimately non-ADR documentation.
describe("Gate G0 (ADR-0007): recursive discovery and coverage disclosure", () => {
  it("d1-nested-log: recognizes ADRs in subdirectories, not just the ADR root", () => {
    const ctx = loadFixtureContext(join(TIER0_DIR, "d1-nested-log"));
    const fileNames = ctx.adrs.map((a) => a.fileName).sort();
    expect(fileNames).toEqual(["0001-root-decision.md", "team-a/0001-nested-decision.md"]);
  });

  it("d1-nested-log: surfaces the stray non-ADR file in the subdirectory", () => {
    const ctx = loadFixtureContext(join(TIER0_DIR, "d1-nested-log"));
    expect(ctx.unrecognizedFiles).toEqual(["docs/adr/team-a/NOTES.md"]);
  });

  it("clean-baseline: reports zero unrecognized files when every markdown file is recognized", () => {
    const ctx = loadFixtureContext(join(TIER0_DIR, "clean-baseline"));
    expect(ctx.unrecognizedFiles).toEqual([]);
  });
});
