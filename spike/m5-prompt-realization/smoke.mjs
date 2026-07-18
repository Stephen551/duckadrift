#!/usr/bin/env node
// THROWAWAY SPIKE: M5.3 PR D live smoke. One live call per S-check against
// the repo's own committed tier1 fixtures, through the REAL claude-code
// transport: stdin prompt delivery, system-file carriage, forced structured
// output, model-pinning echo, and extraction, end to end, with the extracted
// findings pushed through the real citation validator. Every call is counted;
// usage is reported measured. The token is read from the user-scope registry
// at runtime and never printed; the metered API key never enters the spawn
// env (the transport's allowlist excludes it by construction).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "C:/Users/steph/Desktop/SaaS/duckadrift";
const { loadAdrLog } = await import(`file:///${ROOT}/dist/adr/load.js`);
const { TIER1_CHECKS } = await import(`file:///${ROOT}/dist/tier1/checks.js`);
const { isSkip } = await import(`file:///${ROOT}/dist/tier1/select.js`);
const { buildRequest } = await import(`file:///${ROOT}/dist/tier1/prompt.js`);
const { validateCitations } = await import(`file:///${ROOT}/dist/tier1/citations.js`);
const { claudeCodeTransport } = await import(`file:///${ROOT}/dist/tier1/transport.js`);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(__dirname, "captures");
mkdirSync(CAPTURES, { recursive: true });

const token = execFileSync(
  "powershell",
  ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('CLAUDE_CODE_OAUTH_TOKEN','User')"],
  { encoding: "utf8" }
).trim();
if (token === "") {
  console.error("no CLAUDE_CODE_OAUTH_TOKEN in the user scope; refusing to run");
  process.exit(2);
}

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY; // belt; the transport's allowlist already excludes it
env.CLAUDE_CODE_OAUTH_TOKEN = token;

const FIXTURES = {
  S1: "test/fixtures/tier1/s1-contradiction",
  S2: "test/fixtures/tier1/s2-code-vs-decision",
  S3: "test/fixtures/tier1/s3-unrecorded-decision",
  S4: "test/fixtures/tier1/s4-recurring-revision",
  S5: "test/fixtures/tier1/s5-decay",
};

const transport = claudeCodeTransport({ deadlineSeconds: 120, env });
let liveCalls = 0;
const summary = [];

for (const [checkId, rel] of Object.entries(FIXTURES)) {
  const fixtureRoot = join(ROOT, rel);
  const prContext = join(fixtureRoot, "pr-context.json");
  const ctx = loadAdrLog(fixtureRoot, existsSync(prContext) ? prContext : undefined);
  const check = TIER1_CHECKS.find((c) => c.id === checkId);
  const selection = check.selectInput(ctx);
  if (isSkip(selection)) {
    summary.push({ check: checkId, status: "skipped", skip: selection.skip });
    console.log(`${checkId}: skipped (${selection.skip}) — no call`);
    continue;
  }
  const request = buildRequest(check, selection, { model: "claude-sonnet-5", effort: "high" });
  liveCalls += 1;
  const startedAt = Date.now();
  try {
    const result = await transport.send(request);
    const durationMs = Date.now() - startedAt;
    const input = result.response.content[0].input;
    const verdict = validateCitations(input, selection, check.id, check.minDistinctCitedDocuments);
    const record = {
      check: checkId,
      fixture: rel,
      durationMs,
      seamResponse: result.response,
      usage: result.usage,
      validator: {
        accepted: verdict.accepted.length,
        discarded: verdict.discarded.length,
        droppedCitations: verdict.droppedCitations.length,
      },
    };
    writeFileSync(join(CAPTURES, `smoke-${checkId.toLowerCase()}.json`), JSON.stringify(record, null, 2) + "\n");
    summary.push({
      check: checkId,
      status: "ok",
      durationMs,
      usage: result.usage,
      validator: record.validator,
    });
    console.log(
      `${checkId}: ok in ${durationMs}ms; accepted=${verdict.accepted.length} discarded=${verdict.discarded.length}`
    );
  } catch (err) {
    summary.push({ check: checkId, status: "error", message: String(err && err.message) });
    console.log(`${checkId}: ERROR ${String(err && err.message)}`);
  }
}

console.log(`live calls: ${liveCalls}`);
writeFileSync(join(CAPTURES, "smoke-summary.json"), JSON.stringify(summary, null, 2) + "\n");
