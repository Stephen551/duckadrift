import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog } from "../src/adr/load.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures", "adr-filename-conventions");

describe("real-world ADR filename conventions (R5 calibration corpus)", () => {
  const ctx = loadAdrLog(FIXTURE_DIR);

  it("finds all three non-bare-digit filename styles", () => {
    expect(ctx.adrs).toHaveLength(3);
  });

  it("cosmos-sdk style (adr-002-*) parses as number 2", () => {
    const adr = ctx.adrs.find((a) => a.fileName === "adr-002-cosmos-style.md");
    expect(adr?.number).toBe(2);
  });

  it("backstage style (adr003-*, no separator) parses as number 3", () => {
    const adr = ctx.adrs.find((a) => a.fileName === "adr003-backstage-style.md");
    expect(adr?.number).toBe(3);
  });

  it("opendatahub style (ODH-ADR-0004-*, repeated prefix) parses as number 4", () => {
    const adr = ctx.adrs.find((a) => a.fileName === "ODH-ADR-0004-opendatahub-style.md");
    expect(adr?.number).toBe(4);
  });
});
