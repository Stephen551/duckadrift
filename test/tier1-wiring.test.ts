import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

// The CLI wiring (M3.3a — the deviation M3.2 deferred), exercised WITHOUT the
// API through the REAL built CLI: every non-run path stays loud and makes zero
// transport calls. The no-network assertion is behavioral: transport
// construction sits AFTER the status gate in executeReport, so a non-eligible
// run never builds one — proven here by running with a deliberately INVALID
// key and asserting the report carries no error entries and no findings block
// (a network attempt with an invalid key would surface as a rendered Tier 1
// error; its absence plus the correct status block is the no-attempt proof).
// The live path itself is proven by the PR ledger's transcript, not by CI.

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI = join(ROOT, "dist", "cli", "index.js");
const TMP = join(__dirname, "fixtures", ".tmp-wiring");

function writeRepo(name: string, config: string, prContext?: object): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "docs", "adr"), { recursive: true });
  writeFileSync(
    join(dir, "docs", "adr", "0001-decision.md"),
    "---\nstatus: accepted\n---\n\n# ADR-0001: A decision\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n"
  );
  writeFileSync(
    join(dir, "docs", "adr", "README.md"),
    "# ADR index\n\n| ADR | Title |\n|---|---|\n| [0001](0001-decision.md) | A decision |\n"
  );
  writeFileSync(join(dir, ".duckadrift.yml"), config);
  if (prContext) writeFileSync(join(dir, "pr-context.json"), JSON.stringify(prContext));
  return dir;
}

/** Environment for the child CLI: base env minus any real key, plus overrides. */
function cliEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return { ...env, ...overrides };
}

async function runReport(dir: string, env: NodeJS.ProcessEnv, prContext = false): Promise<{ md: string; exitCode: number }> {
  const out = join(dir, "rep.md");
  const args = [CLI, "report", dir, "--out", out];
  if (prContext) args.push("--pr-context", join(dir, "pr-context.json"));
  const child = await execFileAsync("node", args, { env });
  void child;
  return { md: readFileSync(out, "utf-8"), exitCode: 0 };
}

describe("CLI wiring: every non-run path is loud and API-free", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("tier1 enabled + key unset → the no-credentials block, end to end", async () => {
    const dir = writeRepo("no-creds", "tier1:\n  enabled: true\n");
    const { md } = await runReport(dir, cliEnv());
    expect(md).toContain(
      "Tier 1 is enabled, but ANTHROPIC_API_KEY is not present in the environment"
    );
    expect(md).not.toContain("### Findings");
  });

  it("tier1 disabled → the disabled block", async () => {
    const dir = writeRepo("disabled", "tier1:\n  enabled: false\n");
    const { md } = await runReport(dir, cliEnv());
    expect(md).toContain("Tier 1 semantic checks are disabled (tier1.enabled is not set).");
  });

  it("enabled + dummy key + PR mode with no signal → no-signal block, zero transport calls", async () => {
    const dir = writeRepo("no-signal", "tier1:\n  enabled: true\n", {
      changedFiles: ["README.md"],
    });
    const { md } = await runReport(
      dir,
      cliEnv({ ANTHROPIC_API_KEY: "sk-ant-invalid-wiring-test" }),
      true
    );
    expect(md).toContain(
      "Tier 1 skipped: no signal — the diff touches no governed path and trips no architectural signal. Zero API calls made."
    );
    // No findings block and no error lines: an attempted send with this
    // invalid key would have rendered a Tier 1 error entry. Its absence is
    // the behavioral no-network proof.
    expect(md).not.toContain("### Findings");
    expect(md).not.toContain("- error:");
  });

  it("`check` never runs Tier 1, whatever the config and key say", async () => {
    const dir = writeRepo("check-free", "tier1:\n  enabled: true\n");
    const { stdout } = await execFileAsync("node", [CLI, "check", dir], {
      env: cliEnv({ ANTHROPIC_API_KEY: "sk-ant-invalid-wiring-test" }),
    });
    expect(stdout).toContain("0 Tier 0 findings");
    expect(stdout).not.toContain("Tier 1");
  });
});
