#!/usr/bin/env node
// event-outcome-matrix.mjs — the authoritative statement of the action
// wrapper's job-level verdict for every (event × outcome) cell (ADR-0027).
//
// It extracts the REAL "Run duckadrift" bash from action.yml and executes it
// per cell, substituting only the two GitHub template tokens the run script
// contains (github.action_path, github.event_name). The test therefore binds
// to the wrapper exactly as shipped: change the run block and the matrix moves
// with it. Outcomes are synthesised by a stub CLI that drives the wrapper into
// each state (the wrapper's verdict depends only on the CLI's exit code, the
// presence of a report, and its failingCount — never on which real finding
// produced it), plus a throwing annotation stub for the post-report-failure
// row and a recording issue-sweep stub so schedule/dispatch cells don't need a
// live `gh`.
//
// The contract (ADR-0027):
//   - Crash (abnormal exit, no report) → red on every event.
//   - Post-report step failure → red on every event (the run step's set -e).
//   - Clean → green everywhere.
//   - Failing findings: pull_request → red; schedule/workflow_dispatch → green
//     (the tracking issue is the interrupt); every other event (push included)
//     → red, because it has no issue channel and the red is the only honest
//     signal.
//
// Pre-fix, the push+failing cell is GREEN (silent absorption) and this repro
// FAILS there — the red-before. Post-fix, every cell matches and it passes.
//
// Run: node test/action/event-outcome-matrix.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ACTION_YML = join(REPO, "action.yml");
const REAL_EMIT = join(REPO, "action", "emit-annotations.mjs");
const REAL_INTERRUPTS = join(REPO, "action", "emit-interrupts.mjs");

const EVENTS = ["pull_request", "push", "schedule", "workflow_dispatch"];
const OUTCOMES = ["clean", "failing", "crash", "postfail"];

// Extract the dedented bash of the `id: run` step's `run: |` block from
// action.yml. Locates the step by its id, takes the first `run: |` after it,
// and collects the lines indented deeper than the `run:` key, stripping that
// indent. Binds the test to the wrapper's actual shipped text.
function extractRunBlock(yml) {
  const lines = yml.split(/\r?\n/);
  const idIdx = lines.findIndex((l) => /^\s*id:\s*run\s*$/.test(l));
  if (idIdx === -1) throw new Error("could not find the `id: run` step in action.yml");
  let runIdx = -1;
  let runIndent = 0;
  for (let i = idIdx; i < lines.length; i++) {
    const m = /^(\s*)run:\s*\|\s*$/.exec(lines[i]);
    if (m) {
      runIdx = i;
      runIndent = m[1].length;
      break;
    }
  }
  if (runIdx === -1) throw new Error("could not find `run: |` for the run step");
  const body = [];
  let contentIndent = null;
  for (let i = runIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= runIndent) break;
    if (contentIndent === null) contentIndent = indent;
    body.push(line.slice(contentIndent));
  }
  // Trim trailing blank lines.
  while (body.length && body[body.length - 1] === "") body.pop();
  return body.join("\n");
}

// The stub CLI, written into each cell's action_path, that drives the wrapper
// into the requested outcome. Reads --out for the md path; writes both the md
// and duckadrift-report.json into the cwd (the two files the wrapper reads).
function stubCliSource(outcome) {
  if (outcome === "crash") {
    // Abnormal exit, no report — the catastrophic (OOM/SIGKILL-shaped) crash
    // the ADR-0013 backstop exists to catch.
    return `process.exit(137);\n`;
  }
  const failing = outcome === "failing";
  const report = {
    adrDirRelative: "docs/adr",
    failingCount: failing ? 2 : 0,
    tier0Findings: failing
      ? [
          { check: "D3", claim: "ADR-0001 links to `missing.md`, which does not resolve at HEAD.", evidence: [{ adr: "0001-x.md", line: 3 }] },
          { check: "D1", claim: "ADR-0001 has status `wip`, which is not a valid status for this dialect.", evidence: [{ adr: "0001-x.md", line: 1 }] },
        ]
      : [],
  };
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `const argv = process.argv.slice(2);\n` +
    `const outI = argv.indexOf("--out");\n` +
    `const md = outI !== -1 ? argv[outI + 1] : "duckadrift-report.md";\n` +
    `writeFileSync(md, "# duckadrift report\\n\\n${failing ? "2 failing" : "0"} finding(s)\\n");\n` +
    `writeFileSync("duckadrift-report.json", ${JSON.stringify(JSON.stringify(report))});\n` +
    `process.exit(0);\n`
  );
}

const THROWING_EMIT = `console.error("emit-annotations: simulated post-report failure");\nprocess.exit(1);\n`;
// Records that the wrapper routed to the issue channel; always succeeds, so a
// schedule/dispatch cell stays green on the strength of the channel existing.
const ISSUE_SWEEP_STUB = `#!/usr/bin/env bash\necho "issue-sweep: invoked" > "$CELL_SWEEP_MARKER"\nexit 0\n`;

let failed = false;
const results = {};

const root = mkdtempSync(join(tmpdir(), "event-matrix-"));
try {
  const runBlock = extractRunBlock(readFileSync(ACTION_YML, "utf-8"));

  for (const event of EVENTS) {
    for (const outcome of OUTCOMES) {
      const cell = join(root, `${event}__${outcome}`);
      const work = join(cell, "work");
      const actionDir = join(cell, "action_path");
      const runnerTemp = join(cell, "runner_temp");
      mkdirSync(work, { recursive: true });
      mkdirSync(join(actionDir, "dist", "cli"), { recursive: true });
      mkdirSync(join(actionDir, "action"), { recursive: true });
      mkdirSync(runnerTemp, { recursive: true });

      writeFileSync(join(actionDir, "dist", "cli", "index.js"), stubCliSource(outcome));
      // Real annotation emitter, except the post-report-failure row swaps in a
      // stub that throws after the report already exists.
      if (outcome === "postfail") writeFileSync(join(actionDir, "action", "emit-annotations.mjs"), THROWING_EMIT);
      else cpSync(REAL_EMIT, join(actionDir, "action", "emit-annotations.mjs"));
      // The REAL interrupt emitter (ADR-0042): stub reports carry no tier1
      // interrupts, so its zero-interrupt path runs genuinely — prints
      // "0 interrupt(s)" and exits 0 without gh — in every cell that reaches it.
      cpSync(REAL_INTERRUPTS, join(actionDir, "action", "emit-interrupts.mjs"));
      const sweepScript = join(actionDir, "action", "issue-sweep.sh");
      writeFileSync(sweepScript, ISSUE_SWEEP_STUB);

      // Substitute the two template tokens the run block contains. Literal
      // replaceAll — never regex; the tokens contain regex metacharacters.
      const actionPathPosix = actionDir.replace(/\\/g, "/");
      const script = runBlock
        .split("${{ github.action_path }}").join(actionPathPosix)
        .split("${{ github.event_name }}").join(event);

      const sweepMarker = join(cell, "sweep-invoked");
      let exit = 0;
      try {
        execFileSync("bash", ["-c", script], {
          cwd: work,
          env: {
            ...process.env,
            RUNNER_TEMP: runnerTemp.replace(/\\/g, "/"),
            GITHUB_OUTPUT: join(cell, "gh_output").replace(/\\/g, "/"),
            GITHUB_STEP_SUMMARY: join(cell, "gh_summary").replace(/\\/g, "/"),
            GH_TOKEN: "stub-token",
            ADR_DIR: "",
            // The PR number reaches the wrapper via env (M4.4 verifier fix) —
            // the harness supplies one so the pull_request path exercises with
            // a number present, matching the runner's env substitution.
            PR_NUMBER: "7",
            CELL_SWEEP_MARKER: sweepMarker.replace(/\\/g, "/"),
          },
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (e) {
        exit = e.status ?? 1;
      }

      const verdict = exit === 0 ? "green" : "red";
      const swept = existsSync(sweepMarker);
      results[`${event}/${outcome}`] = { verdict, exit, swept };

      const want = expectedVerdict(event, outcome);
      const ok = verdict === want;
      if (!ok) failed = true;
      console.log(`${ok ? "PASS" : "FAIL"} — ${event.padEnd(18)} ${outcome.padEnd(9)} verdict=${verdict.padEnd(5)} expected=${want}${verdict !== want ? "  <-- mismatch" : ""}`);
    }
  }

  // The rendered matrix — the authoritative pre/post-fix statement for the ledger.
  console.log("\n=== event × outcome verdict matrix ===");
  const head = ["event \\ outcome", ...OUTCOMES].map((s) => s.padEnd(18)).join("");
  console.log(head);
  for (const event of EVENTS) {
    const row = [event.padEnd(18)];
    for (const outcome of OUTCOMES) {
      const r = results[`${event}/${outcome}`];
      const channel = r.swept ? " (issue)" : "";
      row.push(`${r.verdict}${channel}`.padEnd(18));
    }
    console.log(row.join(""));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

// ADR-0027's contract, as a pure function so the same matrix states both the
// bug (pre-fix push+failing is green, mismatching this) and the fix.
function expectedVerdict(event, outcome) {
  if (outcome === "crash" || outcome === "postfail") return "red";
  if (outcome === "clean") return "green";
  // failing findings:
  if (event === "schedule" || event === "workflow_dispatch") return "green";
  return "red"; // pull_request, push, and any other channel-less event
}

process.exit(failed ? 1 : 0);
