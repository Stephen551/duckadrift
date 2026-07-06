import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { SetupError } from "../errors.js";
import { MAX_FILE_SIZE_BYTES } from "../repo/walk.js";
import type { Dialect, NumberingGapsMode, NumberingScope } from "../adr/types.js";

const DECLARABLE_DIALECTS = new Set<Dialect>(["nygard", "madr"]);
const DECLARABLE_NUMBERING_SCOPES = new Set<NumberingScope>(["global", "per-directory"]);
const DECLARABLE_NUMBERING_GAPS_MODES = new Set<NumberingGapsMode>(["advisory", "fail"]);

export interface DuckadriftConfig {
  /** Explicit user declaration (`.duckadrift.yml`'s `dialect:` field). Undefined means "not declared" — auto-detection stays a guess (PDR §2.2, ADR-0005). */
  dialect?: Dialect;
  /** Explicit user declaration (`.duckadrift.yml`'s `numbering:` field, ADR-0008). Undefined means "not declared" — `loadAdrLog` defaults to "per-directory". */
  numbering?: NumberingScope;
  /** Explicit user declaration (`.duckadrift.yml`'s `numbering_gaps:` field, ADR-0010). Undefined means "not declared" — `loadAdrLog` defaults to "advisory". */
  numbering_gaps?: NumberingGapsMode;
}

export function loadConfig(repoRoot: string): DuckadriftConfig {
  const configPath = join(repoRoot, ".duckadrift.yml");
  if (!existsSync(configPath)) return {};

  // A `.duckadrift.yml` that is not a regular file — most often a directory of
  // that name (NEW-E) — passes an existsSync/statSync-size check but throws
  // EISDIR on readFileSync. Treat any non-file as no config: defaults with a
  // loud notice, never a crash (the Pact — degrade visibly, don't abort).
  const stat = statSync(configPath);
  if (!stat.isFile()) {
    console.error(
      "duckadrift: .duckadrift.yml is not a regular file — ignoring it and proceeding with defaults."
    );
    return {};
  }

  // The same size cap the repo walk applies to every scanned file (B-10). The
  // config is repo content, so on a fork PR it is attacker-authorable; reading
  // it uncapped crashed the tool at V8's string limit before it could produce a
  // report. An oversized config is a user error — degrade to defaults with a
  // loud notice (the Pact: the watch may fail visibly, never crash silent), not
  // a hard abort mid-scan.
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    console.error(
      `duckadrift: .duckadrift.yml exceeds ${MAX_FILE_SIZE_BYTES} bytes — ignoring it and proceeding with defaults.`
    );
    return {};
  }

  const raw = readFileSync(configPath, "utf-8");
  // Malformed YAML (NEW-F, e.g. `dialect: [`) must be a loud usage error, never
  // an uncaught throw that aborts the scan silent. SetupError maps to exit 2 —
  // the same "your config, not our finding" class as a bad --adr-dir.
  let parsed: Record<string, unknown>;
  try {
    parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).split("\n")[0]!.trim();
    throw new SetupError(`invalid .duckadrift.yml: ${reason}`);
  }
  const config: DuckadriftConfig = {};

  const dialect = parsed.dialect;
  if (typeof dialect === "string" && DECLARABLE_DIALECTS.has(dialect as Dialect)) {
    config.dialect = dialect as Dialect;
  }

  const numbering = parsed.numbering;
  if (typeof numbering === "string" && DECLARABLE_NUMBERING_SCOPES.has(numbering as NumberingScope)) {
    config.numbering = numbering as NumberingScope;
  }

  const numberingGaps = parsed.numbering_gaps;
  if (
    typeof numberingGaps === "string" &&
    DECLARABLE_NUMBERING_GAPS_MODES.has(numberingGaps as NumberingGapsMode)
  ) {
    config.numbering_gaps = numberingGaps as NumberingGapsMode;
  }

  return config;
}
