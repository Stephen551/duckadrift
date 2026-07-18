import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdrLogContext } from "../src/adr/types.js";
import { renderMarkdownReport, withTier1Run } from "../src/report/write.js";
import type { CheckDefinition, CheckInput, Tier1CheckId } from "../src/tier1/checks.js";
import { openSweepCheckpoint, treeIdentityOf } from "../src/tier1/sweep.js";
import { runTier1Checks } from "../src/tier1/runner.js";
import { Tier1TransportError } from "../src/tier1/transport.js";
import type { Tier1Transport, Tier1TransportResult } from "../src/tier1/transport.js";

// The ADR-0045 worlds, proven deterministically: starved (pause at exactly K),
// death (resume sends zero completed units), parity (a resumed sweep's final
// report is byte-identical to an uninterrupted one), refusal (changed tree and
// corrupted bytes both restart loudly), and mid-finding (exhaustion mid-unit
// leaves it incomplete; the resume re-runs it exactly once). Zero live calls;
// the stub transport wraps the seam.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-sweep");

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function checkpointPath(): string {
  mkdirSync(TMP, { recursive: true });
  return join(TMP, "duckadrift-sweep-checkpoint.json");
}

// Three units with distinct inputs (distinct promptHash) and distinct ids.
const UNIT_IDS = ["S1", "S4", "S5"] as const;

function docFor(id: string): { label: string; path: string; content: string } {
  // S5's finding flows through confirmDeadPremise (ADR-0036), which derives
  // referents from citation quotes: its document names a path token that is
  // provably absent under the scratch repoRoot, so the premise is dead and
  // the finding survives deterministically.
  const content =
    id === "S5"
      ? "The S5 decision retires `src/gone-forever.ts` from the tree."
      : `The ${id} decision content for the sweep worlds.`;
  return {
    label: `000${id.slice(1)}-${id.toLowerCase()}.md`,
    path: `docs/adr/000${id.slice(1)}-${id.toLowerCase()}.md`,
    content,
  };
}

function sweepCheck(id: Tier1CheckId): CheckDefinition {
  const input: CheckInput = { documents: [docFor(id)] };
  return {
    id,
    title: `Sweep world check ${id}`,
    instructions: "unused in these tests",
    selectInput: () => input,
    minDistinctCitedDocuments: 1,
  };
}

const CHECKS = UNIT_IDS.map((id) => sweepCheck(id));

// S5 findings go through confirmDeadPremise against ctx; keep the sweep
// context S5-free of that concern by making every finding cite its own
// document with a verbatim quote (validateCitations) and using non-S5
// semantics for S5 via the dead-premise path being irrelevant: the S5 check
// here cites a premise that IS absent from the ctx tree (no files), which
// confirmDeadPremise treats as dead. The parity world only needs
// determinism, which both sides of that branch provide identically.
function responseFor(id: Tier1CheckId): unknown {
  const doc = docFor(id);
  return {
    content: [
      {
        type: "tool_use",
        name: "report_findings",
        input: {
          findings: [
            {
              claim: `Finding from ${id} about a recorded decision.`,
              citations: [{ document: doc.label, quote: doc.content }],
              consequence: "The sweep worlds assert on this deterministic finding.",
              reportedConfidence: 0.9,
            },
          ],
        },
      },
    ],
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 5 },
  };
}

// repoRoot is the scratch dir: confirmDeadPremise walks it (trivially empty),
// and the S5 path token is provably absent there.
const CTX = { repoRoot: TMP, adrs: [], adrDir: "docs/adr" } as unknown as AdrLogContext;

/** A seam stub: canned per-check responses, quota after `quotaAfter` sends, every send counted. */
function sweepTransport(opts: { quotaAfter?: number } = {}): { transport: Tier1Transport; sends: () => number } {
  let sends = 0;
  return {
    sends: () => sends,
    transport: {
      async send(request: object): Promise<Tier1TransportResult> {
        sends += 1;
        if (opts.quotaAfter !== undefined && sends > opts.quotaAfter) {
          throw new Tier1TransportError("quota", "api_error_status 429: stub window exhausted");
        }
        const system = JSON.stringify(request);
        const id = UNIT_IDS.find((u) => system.includes(`Sweep world check ${u}`)) ?? "S1";
        const response = responseFor(id) as Record<string, unknown>;
        return { response, usage: response.usage ?? null };
      },
    },
  };
}

function identity(): { backend: string; model: string; effort: string; treeIdentity: string } {
  return { backend: "api", model: "claude-sonnet-5", effort: "high", treeIdentity: treeIdentityOf(CTX) };
}

describe("starved world: quota pauses at exactly K completed units, loudly (ADR-0045)", () => {
  it("pauses at K=2, writes the checkpoint, reports the block with the unchecked unit enumerated", async () => {
    const path = checkpointPath();
    const { checkpoint } = openSweepCheckpoint(path, identity());
    const { transport, sends } = sweepTransport({ quotaAfter: 2 });

    const run = await runTier1Checks(CTX, CHECKS, transport, { checkpoint });

    expect(sends()).toBe(3); // two completions plus the exhausted third attempt
    expect(run.paused).toEqual({ completed: 2, total: 3, notChecked: ["S5"] });
    expect(run.findings).toHaveLength(2);
    // The checkpoint artifact is on disk with exactly the two completed units.
    const artifact = JSON.parse(readFileSync(path, "utf-8")) as { units: unknown[] };
    expect(artifact.units).toHaveLength(2);

    // The loud block, annex copy per PDR 2.8, with the estimate the caller's clock supplies.
    const status = withTier1Run({ enabled: true, status: "eligible", signals: [] }, run);
    if (status.enabled && status.paused) status.paused.resumeAt = "~19:45";
    const md = renderMarkdownReport([], [], status);
    expect(md).toContain("Tier 1 sweep paused: 2 of 3 ADRs checked; resuming at ~19:45");
    expect(md).toContain("Not checked: S5");
  });
});

describe("death world: a checkpoint left by a dead process resumes with zero re-sent units (ADR-0045)", () => {
  it("resume sends only the unit the dead process never completed, and the sweep completes", async () => {
    const path = checkpointPath();
    // Sweep #1 dies after two units: simulated by recording their outcomes
    // through the same store API a live sweep persists through, then
    // abandoning the process (no finalize, no result).
    {
      const { checkpoint } = openSweepCheckpoint(path, identity());
      const first = sweepTransport();
      const dying = await runTier1Checks(CTX, [CHECKS[0]!, CHECKS[1]!], first.transport, { checkpoint });
      expect(dying.findings).toHaveLength(2);
      expect(first.sends()).toBe(2);
    }
    // Sweep #2: the next scheduled invocation, fresh process, same tree.
    const { checkpoint, refusal } = openSweepCheckpoint(path, identity());
    expect(refusal).toBeUndefined();
    const second = sweepTransport();
    const run = await runTier1Checks(CTX, CHECKS, second.transport, { checkpoint });

    expect(second.sends()).toBe(1); // S5 only; completed units are never re-sent
    expect(run.paused).toBeUndefined();
    expect(run.findings).toHaveLength(3);
  });
});

describe("parity world: a resumed sweep's final report is byte-identical to an uninterrupted one (ADR-0045)", () => {
  it("starved-then-resumed equals never-interrupted, byte for byte", async () => {
    const path = checkpointPath();

    // The uninterrupted reference.
    const reference = await runTier1Checks(CTX, CHECKS, sweepTransport().transport, {});
    const referenceMd = renderMarkdownReport(
      [],
      [],
      withTier1Run({ enabled: true, status: "eligible", signals: [] }, reference)
    );

    // Starve at 2, then resume on a fresh invocation.
    const first = openSweepCheckpoint(path, identity());
    await runTier1Checks(CTX, CHECKS, sweepTransport({ quotaAfter: 2 }).transport, {
      checkpoint: first.checkpoint,
    });
    const second = openSweepCheckpoint(path, identity());
    const resumeStub = sweepTransport();
    const resumed = await runTier1Checks(CTX, CHECKS, resumeStub.transport, {
      checkpoint: second.checkpoint,
    });
    const resumedMd = renderMarkdownReport(
      [],
      [],
      withTier1Run({ enabled: true, status: "eligible", signals: [] }, resumed)
    );

    expect(resumeStub.sends()).toBe(1); // parity holds UNDER resume, not by re-sending
    expect(resumed.paused).toBeUndefined();
    expect(resumedMd).toBe(referenceMd);
  });
});

describe("refusal world: an untrusted checkpoint restarts loudly, never skips (ADR-0045)", () => {
  it("a checkpoint from a DIFFERENT tree refuses with the reason named, and the sweep restarts from zero", async () => {
    const path = checkpointPath();
    const first = openSweepCheckpoint(path, { ...identity(), treeIdentity: "a-different-tree-entirely" });
    first.checkpoint.record(
      { backend: "api", model: "claude-sonnet-5", effort: "high", checkId: "S1", promptHash: "0".repeat(64) },
      { status: "responded", response: responseFor("S1"), usage: null }
    );

    const { checkpoint, refusal } = openSweepCheckpoint(path, identity());
    expect(refusal).toBeDefined();
    expect(String(refusal)).toContain("tree");
    const { transport, sends } = sweepTransport();
    const run = await runTier1Checks(CTX, CHECKS, transport, { checkpoint });
    expect(sends()).toBe(3); // restart from zero: nothing inherited
    expect(run.findings).toHaveLength(3);

    const status = withTier1Run({ enabled: true, status: "eligible", signals: [] }, run);
    if (status.enabled && refusal !== undefined) status.checkpointRefusal = refusal;
    const md = renderMarkdownReport([], [], status);
    expect(md).toContain("checkpoint refused");
  });

  it("a truncated artifact refuses loudly and restarts", async () => {
    const path = checkpointPath();
    writeFileSync(path, '{"schemaVersion":1,"units":[{"trunc');
    const { checkpoint, refusal } = openSweepCheckpoint(path, identity());
    expect(refusal).toBeDefined();
    const { transport, sends } = sweepTransport();
    await runTier1Checks(CTX, CHECKS, transport, { checkpoint });
    expect(sends()).toBe(3);
  });
});

describe("mid-finding world: exhaustion during a unit leaves it incomplete; the resume re-runs it exactly once (ADR-0045)", () => {
  it("the exhausted unit is absent from the checkpoint and sends exactly once on resume", async () => {
    const path = checkpointPath();
    const first = openSweepCheckpoint(path, identity());
    await runTier1Checks(CTX, CHECKS, sweepTransport({ quotaAfter: 2 }).transport, {
      checkpoint: first.checkpoint,
    });
    const artifact = JSON.parse(readFileSync(path, "utf-8")) as { units: Array<{ key: { checkId: string } }> };
    expect(artifact.units.map((u) => u.key.checkId).sort()).toEqual(["S1", "S4"]); // S5 incomplete, always

    const second = openSweepCheckpoint(path, identity());
    const { transport, sends } = sweepTransport();
    const run = await runTier1Checks(CTX, CHECKS, transport, { checkpoint: second.checkpoint });
    expect(sends()).toBe(1); // the incomplete unit re-runs exactly once
    expect(run.findings).toHaveLength(3);
  });
});
