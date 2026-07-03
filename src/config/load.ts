import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Dialect } from "../adr/types.js";

const DECLARABLE_DIALECTS = new Set<Dialect>(["nygard", "madr"]);

export interface DuckadriftConfig {
  /** Explicit user declaration (`.duckadrift.yml`'s `dialect:` field). Undefined means "not declared" — auto-detection stays a guess (PDR §2.2, ADR-0005). */
  dialect?: Dialect;
}

export function loadConfig(repoRoot: string): DuckadriftConfig {
  const configPath = join(repoRoot, ".duckadrift.yml");
  if (!existsSync(configPath)) return {};

  const raw = readFileSync(configPath, "utf-8");
  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const dialect = parsed.dialect;

  if (typeof dialect === "string" && DECLARABLE_DIALECTS.has(dialect as Dialect)) {
    return { dialect: dialect as Dialect };
  }
  return {};
}
