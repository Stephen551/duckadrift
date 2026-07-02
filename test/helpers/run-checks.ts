import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAdrLog } from "../../src/adr/load.js";
import { TIER_ZERO_CHECKS, runAllTierZeroChecks } from "../../src/checks/index.js";
import { sortFindings } from "../../src/report/write.js";
import type { AdrLogContext } from "../../src/adr/types.js";
import type { Finding, TierZeroCheckId } from "../../src/types.js";

export function loadFixtureContext(fixtureDir: string): AdrLogContext {
  const prContextPath = join(fixtureDir, "pr-context.json");
  return loadAdrLog(fixtureDir, existsSync(prContextPath) ? prContextPath : undefined);
}

export function runFixture(fixtureDir: string): Finding[] {
  return sortFindings(runAllTierZeroChecks(loadFixtureContext(fixtureDir)));
}

export function runSingleCheck(fixtureDir: string, checkId: TierZeroCheckId): Finding[] {
  return sortFindings(TIER_ZERO_CHECKS[checkId](loadFixtureContext(fixtureDir)));
}
