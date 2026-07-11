import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAdrFile } from "../src/adr/parse.js";
import { effectiveStatus, isAccepted, type EffectiveStatusSource } from "../src/adr/status.js";
import { isAcceptedAdr } from "../src/tier1/select.js";

// One status recognizer for every dialect (ADR-0040). The corpus capture found
// that five of seven public repos declared status as a `## Status` heading — the
// original ADR form's own dialect — and nothing read it. These fixtures are the
// isolating cases (repo law §5.3): each dialect, the precedence rule, and the
// tf-proxmox shape that actually stopped the capture.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "status-dialects");

function load(fileName: string) {
  const path = join(FIXTURES, fileName);
  return parseAdrFile(readFileSync(path, "utf-8"), path, fileName);
}

interface Case {
  file: string;
  value: string | null;
  source: EffectiveStatusSource;
  accepted: boolean;
}

const CASES: Case[] = [
  { file: "0001-frontmatter-accepted.md", value: "accepted", source: "frontmatter", accepted: true },
  { file: "0002-heading-accepted.md", value: "accepted", source: "heading", accepted: true },
  { file: "0003-heading-accepted-emoji.md", value: "accepted", source: "heading", accepted: true },
  { file: "0004-bold-line-accepted.md", value: "accepted", source: "bold-line", accepted: true },
  { file: "0005-heading-superseded.md", value: "superseded", source: "heading", accepted: false },
  { file: "0006-no-status.md", value: null, source: "none", accepted: false },
  { file: "0007-frontmatter-superseded-heading-accepted.md", value: "superseded", source: "frontmatter", accepted: false },
  { file: "0008-heading-accepted-datesuffix.md", value: "accepted", source: "heading", accepted: true },
  { file: "0009-proxmox-shaped.md", value: "accepted", source: "heading", accepted: true },
  { file: "0010-heading-accepted-trailing-period.md", value: "accepted", source: "heading", accepted: true },
  { file: "0011-heading-emphasis-approved.md", value: "approved", source: "heading", accepted: false },
];

describe("effectiveStatus resolves every dialect to {value, source}", () => {
  for (const c of CASES) {
    it(`${c.file} → ${JSON.stringify(c.value)} from ${c.source}`, () => {
      expect(effectiveStatus(load(c.file))).toEqual({ value: c.value, source: c.source });
      expect(isAccepted(load(c.file))).toBe(c.accepted);
    });
  }
});

describe("precedence — declared-first, a later dialect never overrides an earlier one", () => {
  it("frontmatter superseded beats a heading that says accepted", () => {
    const adr = load("0007-frontmatter-superseded-heading-accepted.md");
    expect(effectiveStatus(adr)).toEqual({ value: "superseded", source: "frontmatter" });
    expect(isAccepted(adr)).toBe(false);
  });
});

describe("the heading dialect the recognizer used to miss", () => {
  it("reads a plain `## Status` heading section", () => {
    expect(isAccepted(load("0002-heading-accepted.md"))).toBe(true);
  });
  it("strips a leading symbol before the status token (✅ Accepted)", () => {
    expect(effectiveStatus(load("0003-heading-accepted-emoji.md")).value).toBe("accepted");
  });
  it("takes the first word-run, ignoring a trailing date (Accepted — 2026-07-11)", () => {
    expect(effectiveStatus(load("0008-heading-accepted-datesuffix.md")).value).toBe("accepted");
  });
  it("resolves the exact tf-proxmox shape that stopped the corpus capture", () => {
    // ## Status\n\nAccepted\n\n## Date... — the real dialect, 8/8 of proxmox's ADRs.
    expect(isAccepted(load("0009-proxmox-shaped.md"))).toBe(true);
  });
  it("strips a trailing period from the token (cosmos's `Accepted.`)", () => {
    // The period made three genuinely accepted cosmos ADRs read as "accepted.".
    expect(effectiveStatus(load("0010-heading-accepted-trailing-period.md")).value).toBe("accepted");
  });
  it("strips wrapping markdown emphasis from the token (edgex's `**Approved**`)", () => {
    // The emphasis corrupted the value to "approved**"; the token must be clean.
    // Value is "approved", NOT accepted — the corruption is fixed, the vocabulary
    // is left as-is (approved is not mapped to the accepted family here).
    expect(effectiveStatus(load("0011-heading-emphasis-approved.md")).value).toBe("approved");
    expect(isAccepted(load("0011-heading-emphasis-approved.md"))).toBe(false);
  });
});

describe("non-accepted statuses are not accepted in any dialect", () => {
  it("a heading superseded is not accepted", () => {
    expect(isAccepted(load("0005-heading-superseded.md"))).toBe(false);
  });
  it("a record that declares no status at all is not accepted (and is honestly 'none')", () => {
    expect(effectiveStatus(load("0006-no-status.md"))).toEqual({ value: null, source: "none" });
    expect(isAccepted(load("0006-no-status.md"))).toBe(false);
  });
});

describe("select.ts isAcceptedAdr delegates exactly to isAccepted", () => {
  it("agrees with isAccepted on every dialect fixture", () => {
    for (const c of CASES) {
      const adr = load(c.file);
      expect(isAcceptedAdr(adr)).toBe(isAccepted(adr));
    }
  });
});
