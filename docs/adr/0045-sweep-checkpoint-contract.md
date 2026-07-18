---
status: accepted
date: 2026-07-18
severity: elevated
---

# ADR-0045: The sweep checkpoint contract: pause visibly, resume exactly, refuse loudly

## Status

Accepted, 2026-07-18. Ruled on the open PR per the retired-flip lifecycle.

## Context

PDR 2.8 requires sweeps to be checkpointed and resumable: on quota exhaustion the run reports "N of M ADRs checked; resuming at ~HH:MM" loudly and auto-resumes; the watch may pause visibly, it never quietly stands down. A scheduled CI job cannot sleep through a quota window, so auto-resume means resume-on-next-invocation: the exhausted run checkpoints, reports, exits cleanly, and the next scheduled run continues from the checkpoint instead of restarting. A resume depends on the checkpoint's shape, which makes that shape a contract, not an implementation detail.

## Decision

1. Checkpointing lives in the sweep runner and is transport-agnostic: the transport only classifies failures (ADR-0044's taxonomy); the runner decides what pauses, what completes, and what resumes. An api-backend sweep interrupted by process death benefits identically.
2. The checkpoint artifact is a JSON file: `schemaVersion`; the sweep key (backend, model, effort); the tree identity the sweep ran against (a digest over every decision record's file name and content hash, plus the ADR directory); the completed units keyed by the full recording tuple (backend, model, effort, checkId, promptHash), each carrying its outcome verbatim (the seam's response and usage for a responded unit, the error message for an errored one); and progress counts.
3. Completion semantics: a unit is complete when its outcome is stored, whether that outcome is a response or a non-quota error. A completed unit is never re-sent; a resume re-derives its findings locally from the stored outcome through the same pipeline, so a resumed sweep's final report is byte-identical to an uninterrupted one. Quota exhaustion mid-unit leaves that unit on the incomplete side, always; the resume re-runs it exactly once. A completed sweep deletes its checkpoint.
4. Integrity is refusal-first: a checkpoint whose tree identity or sweep key disagrees with the present run, or whose bytes do not parse to this contract, is refused loudly and the sweep restarts from zero with the refusal named in the report. Refusal means restart-with-report, never skip; resuming across changed bytes would silently narrow coverage.
5. The quota class triggers checkpoint-and-report: the annex and job summary carry "Tier 1 sweep paused: N of M ADRs checked; resuming at ~HH:MM" with the unchecked units enumerated by name, never summarized. The ~HH:MM is the estimated window reopening in the PDR's own tilde format; the estimate is prescribed, not a measured number. A visible pause exits as success: a pause is not a failure.

## Consequences

- The starved-world behavior is provable in the deterministic harness: pause at exactly K completed units, loud block, clean exit, and a resume that sends only what was never completed.
- The next scheduled invocation is the resume mechanism; no process sleeps through a quota window.
- The artifact's shape can only change through this contract, and a checkpoint that cannot be trusted is never partially trusted.
