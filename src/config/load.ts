import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Dialect, NumberingScope } from "../adr/types.js";

const DECLARABLE_DIALECTS = new Set<Dialect>(["nygard", "madr"]);
const DECLARABLE_NUMBERING_SCOPES = new Set<NumberingScope>(["global", "per-directory"]);

export interface DuckadriftConfig {
  /** Explicit user declaration (`.duckadrift.yml`'s `dialect:` field). Undefined means "not declared" — auto-detection stays a guess (PDR §2.2, ADR-0005). */
  dialect?: Dialect;
  /** Explicit user declaration (`.duckadrift.yml`'s `numbering:` field, ADR-0008). Undefined means "not declared" — `loadAdrLog` defaults to "per-directory". */
  numbering?: NumberingScope;
}

export function loadConfig(repoRoot: string): DuckadriftConfig {
  const configPath = join(repoRoot, ".duckadrift.yml");
  if (!existsSync(configPath)) return {};

  const raw = readFileSync(configPath, "utf-8");
  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const config: DuckadriftConfig = {};

  const dialect = parsed.dialect;
  if (typeof dialect === "string" && DECLARABLE_DIALECTS.has(dialect as Dialect)) {
    config.dialect = dialect as Dialect;
  }

  const numbering = parsed.numbering;
  if (typeof numbering === "string" && DECLARABLE_NUMBERING_SCOPES.has(numbering as NumberingScope)) {
    config.numbering = numbering as NumberingScope;
  }

  return config;
}
