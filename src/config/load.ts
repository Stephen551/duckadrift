import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { SetupError } from "../errors.js";
import { MAX_FILE_SIZE_BYTES } from "../repo/walk.js";
import type { Dialect, NumberingGapsMode, NumberingScope } from "../adr/types.js";

const DECLARABLE_DIALECTS = new Set<Dialect>(["nygard", "madr"]);
const DECLARABLE_NUMBERING_SCOPES = new Set<NumberingScope>(["global", "per-directory"]);
const DECLARABLE_NUMBERING_GAPS_MODES = new Set<NumberingGapsMode>(["advisory", "fail"]);

/**
 * The Tier 1 configuration surface (ADR-0029, PDR §2.7). Always fully
 * populated: absence of the file or the block is the common case and yields
 * these defaults. `model` and `effort` are not cosmetic — they are two-fifths
 * of the recording key (ADR-0028) and the calibration key (PDR §2.6), so the
 * defaults are the tuple the shipped calibration will be measured against.
 */
export interface Tier1Config {
  enabled: boolean; // default false
  backend: "api" | "claude-code"; // default "api"; the ADR-0044 closed set
  model: string; // default "claude-sonnet-5"
  effort: string; // default "high"
  /**
   * The transport's owned deadline in seconds (ADR-0044 decision 2), consumed
   * by the claude-code transport. A config value with a sane default, never a
   * constant in check code; the default's rationale is the M5.1 ledger's
   * measured evidence.
   */
  deadline_seconds: number; // default 120
}

const TIER1_KEYS = ["enabled", "backend", "model", "effort", "deadline_seconds"] as const;

function tier1Defaults(): Tier1Config {
  return {
    enabled: false,
    backend: "api",
    model: "claude-sonnet-5",
    effort: "high",
    deadline_seconds: 120,
  };
}

export interface DuckadriftConfig {
  /** Explicit user declaration (`.duckadrift.yml`'s `dialect:` field). Undefined means "not declared" — auto-detection stays a guess (PDR §2.2, ADR-0005). */
  dialect?: Dialect;
  /** Explicit user declaration (`.duckadrift.yml`'s `numbering:` field, ADR-0008). Undefined means "not declared" — `loadAdrLog` defaults to "per-directory". */
  numbering?: NumberingScope;
  /** Explicit user declaration (`.duckadrift.yml`'s `numbering_gaps:` field, ADR-0010). Undefined means "not declared" — `loadAdrLog` defaults to "advisory". */
  numbering_gaps?: NumberingGapsMode;
  /** Always populated (ADR-0029): the defaulting happens once, at load time, not per-consumer. */
  tier1: Tier1Config;
}

/**
 * Parses the optional `tier1:` block. The loud/quiet split follows the
 * loader's existing doctrine — degrade visibly, crash never — but a config the
 * user WROTE and we cannot honor is a SetupError, the same class as malformed
 * YAML: honoring half of an explicit declaration is a guess about intent.
 * A bare `tier1:` key (YAML null) carries nothing and is treated as absent,
 * matching the frontmatter empty-block precedent.
 */
function parseTier1(raw: unknown, quiet: boolean): Tier1Config {
  const config = tier1Defaults();
  if (raw === undefined || raw === null) return config;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SetupError("invalid .duckadrift.yml: tier1 must be a mapping of fields");
  }
  const block = raw as Record<string, unknown>;

  // A typo like `enable: true` silently meaning "Tier 1 never runs" is a
  // dormancy shape — the user believes the watch is up. Name every unknown
  // key loudly, then proceed on what was understood.
  for (const key of Object.keys(block)) {
    if (!(TIER1_KEYS as readonly string[]).includes(key) && !quiet) {
      console.error(
        `duckadrift: unknown key "tier1.${key}" in .duckadrift.yml — ignored. Supported: enabled, backend, model, effort, deadline_seconds.`
      );
    }
  }

  if (block.enabled !== undefined) {
    if (typeof block.enabled !== "boolean") {
      throw new SetupError("invalid .duckadrift.yml: tier1.enabled must be true or false");
    }
    config.enabled = block.enabled;
  }

  if (block.backend !== undefined) {
    if (block.backend !== "api" && block.backend !== "claude-code") {
      throw new SetupError(
        `invalid .duckadrift.yml: tier1.backend ${JSON.stringify(block.backend)} is not supported — this build supports backend: api or claude-code (ADR-0044)`
      );
    }
    config.backend = block.backend;
  }

  for (const key of ["model", "effort"] as const) {
    const value = block[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value === "") {
      throw new SetupError(`invalid .duckadrift.yml: tier1.${key} must be a non-empty string`);
    }
    config[key] = value;
  }

  if (block.deadline_seconds !== undefined) {
    const value = block.deadline_seconds;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new SetupError(
        "invalid .duckadrift.yml: tier1.deadline_seconds must be a positive number of seconds"
      );
    }
    config.deadline_seconds = value;
  }

  return config;
}

/**
 * `quiet: true` suppresses the loader's stderr notices (not its SetupErrors).
 * The CLI legitimately loads the config twice per run — once inside
 * `loadAdrLog` (dialect/numbering) and once to resolve Tier 1 status — and the
 * second call passes quiet so per-run advice is printed once, not twice.
 */
export function loadConfig(repoRoot: string, opts: { quiet?: boolean } = {}): DuckadriftConfig {
  const quiet = opts.quiet === true;
  const configPath = join(repoRoot, ".duckadrift.yml");
  if (!existsSync(configPath)) return { tier1: tier1Defaults() };

  // A `.duckadrift.yml` that is not a regular file — most often a directory of
  // that name (NEW-E) — passes an existsSync/statSync-size check but throws
  // EISDIR on readFileSync. Treat any non-file as no config: defaults with a
  // loud notice, never a crash (the Pact — degrade visibly, don't abort).
  const stat = statSync(configPath);
  if (!stat.isFile()) {
    if (!quiet) {
      console.error(
        "duckadrift: .duckadrift.yml is not a regular file — ignoring it and proceeding with defaults."
      );
    }
    return { tier1: tier1Defaults() };
  }

  // The same size cap the repo walk applies to every scanned file (B-10). The
  // config is repo content, so on a fork PR it is attacker-authorable; reading
  // it uncapped crashed the tool at V8's string limit before it could produce a
  // report. An oversized config is a user error — degrade to defaults with a
  // loud notice (the Pact: the watch may fail visibly, never crash silent), not
  // a hard abort mid-scan.
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    if (!quiet) {
      console.error(
        `duckadrift: .duckadrift.yml exceeds ${MAX_FILE_SIZE_BYTES} bytes — ignoring it and proceeding with defaults.`
      );
    }
    return { tier1: tier1Defaults() };
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
  const config: DuckadriftConfig = { tier1: parseTier1(parsed.tier1, quiet) };

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
