#!/usr/bin/env node
// THROWAWAY SPIKE: M5.3 PR E parity-capture orchestrator. Drives captureOne
// over a roster of repos with the claude-code tuple FORCED (the YIELD.md
// orchestrator precedent: the calibration key never comes from a target
// repo's config). The roster file carries machine paths and lives on the
// ADR-0040 private side; its path arrives via argv and never appears here.
//
// Checkpointed by construction (ADR-0037): an already-captured unit skips
// with zero spend, so a quota pause resumes on the next invocation. Quota
// exhaustion journals a visible pause and exits 0 (a pause is not a
// failure, ADR-0045); any other transport failure journals and exits 1.
// The journal carries names, statuses, timings, and usage only, never paths.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "C:/Users/steph/Desktop/SaaS/duckadrift";
const { loadAdrLog } = await import(`file:///${ROOT}/dist/adr/load.js`);
const { TIER1_CHECKS } = await import(`file:///${ROOT}/dist/tier1/checks.js`);
const { captureOne } = await import(`file:///${ROOT}/dist/tier1/capture.js`);
const { claudeCodeTransport, Tier1TransportError } = await import(`file:///${ROOT}/dist/tier1/transport.js`);

const rosterPath = process.argv[2];
if (rosterPath === undefined) {
  console.error("usage: node orchestrate.mjs <roster.json> (the roster lives on the private side)");
  process.exit(2);
}
const roster = JSON.parse(readFileSync(rosterPath, "utf-8"));

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
delete env.ANTHROPIC_API_KEY;
env.CLAUDE_CODE_OAUTH_TOKEN = token;

// The forced tuple (YIELD.md precedent; runtime model claude-sonnet-5, never
// fable, director ruling).
const CONFIG = { model: "claude-sonnet-5", effort: "high" };
const BACKEND = "claude-code";
// The ratified default (120s) suits gated PR-mode inputs; corpus whole-log
// calls measured 114.7s at 57K input tokens with near-zero output, and the
// first batch run proved the deadline fires exactly as owned (duckadrift/S4
// killed at 120s, journaled, resumed at $0). 900s bounds the largest private
// log (132K in, 13K out on the api tuple) with headroom; deadline_seconds is
// config precisely so a sweep can carry its own ceiling.
const transport = claudeCodeTransport({ deadlineSeconds: 900, env });

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOURNAL_PATH = join(__dirname, "journal.json");
const journal = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) : { runs: [] };
const run = { startedAt: new Date().toISOString(), units: [], outcome: "completed" };
journal.runs.push(run);
const saveJournal = () => writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2) + "\n");

let liveCalls = 0;
let paused = false;

outer: for (const repo of roster.repos) {
  let ctx;
  try {
    // adrDir comes from the roster, mirroring the api harvest manifests
    // exactly: parity means the same trees read the same way.
    ctx = loadAdrLog(repo.root, undefined, repo.adrDir);
  } catch (err) {
    run.units.push({ repo: repo.name, check: "(load)", status: "errored", message: String(err && err.message) });
    run.outcome = "errored";
    saveJournal();
    console.error(`${repo.name}: LOAD ERROR ${String(err && err.message)}`);
    process.exit(1);
  }
  for (const checkId of roster.checks) {
    const check = TIER1_CHECKS.find((c) => c.id === checkId);
    const recordingPath = join(repo.out, `${checkId.toLowerCase()}.claude-code.recording.json`);
    mkdirSync(dirname(recordingPath), { recursive: true });
    const startedAt = Date.now();
    try {
      const result = await captureOne({ ctx, check, config: CONFIG, backend: BACKEND, transport, recordingPath });
      const durationMs = Date.now() - startedAt;
      if (result.status === "captured") liveCalls += 1;
      run.units.push({
        repo: repo.name,
        check: checkId,
        status: result.status,
        durationMs,
        ...(result.usage !== undefined ? { usage: result.usage } : {}),
      });
      console.log(`${repo.name}/${checkId}: ${result.status} (${durationMs}ms)`);
      saveJournal();
    } catch (err) {
      const isQuota = err instanceof Tier1TransportError && err.kind === "quota";
      run.units.push({
        repo: repo.name,
        check: checkId,
        status: isQuota ? "quota-paused" : "errored",
        message: String(err && err.message),
      });
      if (isQuota) {
        run.outcome = "quota-paused";
        paused = true;
        console.log(`${repo.name}/${checkId}: QUOTA PAUSE; the batch resumes on the next invocation (completed units skip at $0)`);
        saveJournal();
        break outer;
      }
      run.outcome = "errored";
      console.error(`${repo.name}/${checkId}: ERROR ${String(err && err.message)}`);
      saveJournal();
      process.exit(1);
    }
  }
}

run.finishedAt = new Date().toISOString();
saveJournal();
console.log(`live calls this run: ${liveCalls}; outcome: ${run.outcome}`);
process.exit(paused ? 0 : 0);
