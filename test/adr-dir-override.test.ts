import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrLog, resolveAdrDir } from "../src/adr/load.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures", "adr-dir-override");

describe("--adr-dir override", () => {
  it("auto-detection fails on a repo whose ADR log isn't at docs/adr or doc/adr", () => {
    expect(() => resolveAdrDir(FIXTURE_DIR)).toThrow(/No ADR directory found/);
  });

  it("an explicit relative override finds the real ADR directory", () => {
    const adrDir = resolveAdrDir(FIXTURE_DIR, "decisions");
    expect(adrDir).toBe(join(FIXTURE_DIR, "decisions"));
  });

  it("loadAdrLog with the override loads the ADR log from the non-standard path", () => {
    const ctx = loadAdrLog(FIXTURE_DIR, undefined, "decisions");
    expect(ctx.adrs).toHaveLength(1);
    expect(ctx.adrs[0]?.fileName).toBe("0001-example.md");
  });

  it("an override pointing nowhere throws a clear error", () => {
    expect(() => resolveAdrDir(FIXTURE_DIR, "nonexistent-dir")).toThrow(
      /--adr-dir does not point to an existing directory/
    );
  });
});
