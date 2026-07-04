import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTION_YML = readFileSync(join(__dirname, "..", "action.yml"), "utf-8");

// H1 (ADR-0013): the base ref and the adr-dir input are trusted-side (a branch
// name, a workflow-author input), not repo file content — but interpolating
// them directly into a `run:` script is the script-injection shape. They now
// flow through the environment and are referenced as "$VAR". This pins that.

describe("H1: action.yml passes untrusted-shaped values via env, not run-block interpolation", () => {
  it("the base ref is bound to an env var and used as \"$BASE_REF\"", () => {
    expect(ACTION_YML).toContain("BASE_REF: ${{ github.event.pull_request.base.ref }}");
    expect(ACTION_YML).toContain('git fetch origin "$BASE_REF"');
  });

  it("the adr-dir input is bound to an env var and used as \"$ADR_DIR\"", () => {
    expect(ACTION_YML).toContain("ADR_DIR: ${{ inputs.adr-dir }}");
    expect(ACTION_YML).toContain('"$ADR_DIR"');
  });

  it("neither value is interpolated inside a git fetch or the ARGS array", () => {
    expect(ACTION_YML).not.toContain('git fetch origin "${{');
    expect(ACTION_YML).not.toContain('--adr-dir "${{ inputs.adr-dir }}"');
    expect(ACTION_YML).not.toContain('[ -n "${{ inputs.adr-dir }}" ]');
  });
});
