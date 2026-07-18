import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { SetupError } from "../src/errors.js";

// The Tier 1 config surface (ADR-0029, PDR §2.7): defaults with no file, exact
// parsing of a full block, loud SetupErrors for a config the user wrote and
// this build cannot honor, and the named-on-stderr unknown-key notice.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-tier1-config");

const TIER1_DEFAULTS = {
  enabled: false,
  backend: "api",
  model: "claude-sonnet-5",
  effort: "high",
  deadline_seconds: 120,
};

function writeRepo(config?: string): string {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  if (config !== undefined) writeFileSync(join(TMP, ".duckadrift.yml"), config);
  return TMP;
}

describe("tier1 config: defaults (PDR §2.7 — absence is the common case)", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("absent file → full tier1 defaults", () => {
    expect(loadConfig(writeRepo()).tier1).toEqual(TIER1_DEFAULTS);
  });

  it("present file, absent tier1 block → full tier1 defaults", () => {
    expect(loadConfig(writeRepo("dialect: nygard\n")).tier1).toEqual(TIER1_DEFAULTS);
  });

  it("a bare `tier1:` key (YAML null) carries nothing → defaults, not an error", () => {
    expect(loadConfig(writeRepo("tier1:\n")).tier1).toEqual(TIER1_DEFAULTS);
  });

  it("a full valid block is parsed exactly", () => {
    const dir = writeRepo(
      [
        "tier1:",
        "  enabled: true",
        "  backend: api",
        "  model: claude-opus-5",
        "  effort: medium",
        "  deadline_seconds: 45",
      ].join("\n")
    );
    expect(loadConfig(dir).tier1).toEqual({
      enabled: true,
      backend: "api",
      model: "claude-opus-5",
      effort: "medium",
      deadline_seconds: 45,
    });
  });

  it("a partial block keeps defaults for the unset keys", () => {
    expect(loadConfig(writeRepo("tier1:\n  enabled: true\n")).tier1).toEqual({
      ...TIER1_DEFAULTS,
      enabled: true,
    });
  });
});

describe("tier1 config: a config the user wrote and we cannot honor is a SetupError", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("backend: claude-code is accepted (ADR-0044; the M5 rejection is retired)", () => {
    const dir = writeRepo("tier1:\n  backend: claude-code\n");
    expect(loadConfig(dir).tier1.backend).toBe("claude-code");
  });

  it("a backend outside the closed set → SetupError naming the value and the supported set", () => {
    const dir = writeRepo("tier1:\n  backend: openai\n");
    expect(() => loadConfig(dir)).toThrowError(
      'invalid .duckadrift.yml: tier1.backend "openai" is not supported — this build supports backend: api or claude-code (ADR-0044)'
    );
    expect(() => loadConfig(dir)).toThrowError(SetupError);
  });

  it("a non-positive or non-numeric deadline_seconds → SetupError", () => {
    expect(() => loadConfig(writeRepo("tier1:\n  deadline_seconds: 0\n"))).toThrowError(
      "invalid .duckadrift.yml: tier1.deadline_seconds must be a positive number of seconds"
    );
    expect(() => loadConfig(writeRepo('tier1:\n  deadline_seconds: "soon"\n'))).toThrowError(
      "invalid .duckadrift.yml: tier1.deadline_seconds must be a positive number of seconds"
    );
  });

  it("non-boolean enabled → SetupError", () => {
    const dir = writeRepo('tier1:\n  enabled: "yes"\n');
    expect(() => loadConfig(dir)).toThrowError(
      "invalid .duckadrift.yml: tier1.enabled must be true or false"
    );
  });

  it("non-string model → SetupError", () => {
    const dir = writeRepo("tier1:\n  model: 5\n");
    expect(() => loadConfig(dir)).toThrowError(
      "invalid .duckadrift.yml: tier1.model must be a non-empty string"
    );
  });

  it("empty-string effort → SetupError", () => {
    const dir = writeRepo('tier1:\n  effort: ""\n');
    expect(() => loadConfig(dir)).toThrowError(
      "invalid .duckadrift.yml: tier1.effort must be a non-empty string"
    );
  });

  it("tier1 present but not a mapping → SetupError", () => {
    const dir = writeRepo("tier1: enabled\n");
    expect(() => loadConfig(dir)).toThrowError(
      "invalid .duckadrift.yml: tier1 must be a mapping of fields"
    );
  });
});

describe("tier1 config: unknown keys are named on stderr, never silently ignored", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("a typo like `enable:` is named, parsing continues, defaults are honored", () => {
    // The dormancy shape ADR-0029 names: a silently ignored `enable: true`
    // means the user believes the watch is up while Tier 1 never runs.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = writeRepo("tier1:\n  enable: true\n");
    const config = loadConfig(dir);
    expect(config.tier1).toEqual(TIER1_DEFAULTS);
    expect(errSpy).toHaveBeenCalledWith(
      'duckadrift: unknown key "tier1.enable" in .duckadrift.yml — ignored. Supported: enabled, backend, model, effort, deadline_seconds.'
    );
  });

  it("each unknown key gets its own notice", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = writeRepo("tier1:\n  foo: 1\n  bar: 2\n  enabled: true\n");
    expect(loadConfig(dir).tier1.enabled).toBe(true);
    const notices = errSpy.mock.calls.map((c) => String(c[0]));
    expect(notices).toContain(
      'duckadrift: unknown key "tier1.foo" in .duckadrift.yml — ignored. Supported: enabled, backend, model, effort, deadline_seconds.'
    );
    expect(notices).toContain(
      'duckadrift: unknown key "tier1.bar" in .duckadrift.yml — ignored. Supported: enabled, backend, model, effort, deadline_seconds.'
    );
  });

  it("quiet: true suppresses the notice (the CLI's second load), never the SetupErrors", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = writeRepo("tier1:\n  foo: 1\n");
    loadConfig(dir, { quiet: true });
    expect(errSpy).not.toHaveBeenCalled();
    const badDir = writeRepo("tier1:\n  backend: openai\n");
    expect(() => loadConfig(badDir, { quiet: true })).toThrowError(SetupError);
  });
});
