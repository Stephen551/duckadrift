---
status: accepted
date: 2026-07-18
severity: critical
---

# ADR-0047: The sweep checkpoint is never trusted input: resume removed, restart in its place

## Status

Accepted, 2026-07-18. Ruled on the open PR per the retired-flip lifecycle. Partially supersedes ADR-0045 (the cross-run resume clause), which is left in place as the record of the decision this one reverses.

## Context

ADR-0045 gave the sweep a checkpoint that pauses visibly and resumes exactly across separate runs, so a paid unit is never re-billed across a quota window: the exhausted run writes its progress, exits clean, and the next scheduled run continues from where it stopped. That resume reads the checkpoint from `<repoRoot>/duckadrift-sweep-checkpoint.json`, a file inside the scanned workspace.

ADR-0046 fixed the threat model: the scanned repo is untrusted input. The two collide. Stage 0's red corpus reproduced the collision against this tree: a committed checkpoint whose units are all complete with empty findings suppresses every finding and the run reports clean with zero transport calls (attack 1); a committed unit outcome carrying a forged finding whose quote byte-exists in a real ADR passes citation validation and reaches the report, again with zero calls (attack 2). ADR-0045's refusal-first integrity check does not close this: the tree-identity digest is computed over the repo's own ADR files, so the repo that plants the checkpoint owns the identity and matches it trivially. Identity was never a defense against the actor who writes the tree.

## Decision

Cross-run resume is removed. The sweep never reads a checkpoint from disk as trusted input.

1. The runner no longer accepts or consults a checkpoint. Every eligible unit is sent every run; no unit outcome is ever replayed from stored state. The checkpoint module (`src/tier1/sweep.ts`) and the runner's checkpoint parameter are deleted, so there is no code path that reads sweep state from the workspace.
2. The report pipeline opens no checkpoint file, and none is written. A committed `<repoRoot>/duckadrift-sweep-checkpoint.json` is ignored by construction: nothing reads it.
3. The visible pause stays (ADR-0045's "pause visibly" half is kept). A quota-exhausted run still stops early, reports "N of M checks completed", and enumerates the unchecked units by name, never summarized (PDR 2.8). What changes is the promise: the report says the next run restarts from the beginning, not that it resumes, and it carries no resume-at estimate.

## The trade, named honestly

ADR-0045 promised "resume exactly" so that a paid unit is never re-paid across a pause. This reverses that. A quota-exhausted or crashed sweep re-bills the completed units on its next run. The cost is real and is not smoothed over: re-billing across a quota window is the accepted price. The property bought is that the scanned repo can never plant a checkpoint the tool trusts: no suppressed drift, no forged finding, no replayed outcome. Under ADR-0046's threat model that property outranks the resilience, so the resilience is what gives way.

## Gate G5 changes meaning

G5's behavioral half read "pause visibly, resume exactly". It becomes "pause visibly, restart cleanly". The starved-world proof changes with it: it no longer shows a resume that sends only the incomplete units; it shows that the next run redoes the work and that no on-disk sweep state is trusted. The pause-report copy from M5.4 ("N of M checks completed") stays honest, but it now names a restart, not a resume, and drops the resume-at time.

## Consequences

- ADR-0045's "resume exactly" clause is superseded here; the rest of ADR-0045 (loud reporting, the visible pause, skips spoken aloud) still holds. ADR-0045 is not edited: a reversed decision stays in the log as its own scar, because the product dogfoods its own decision history and a quietly-rewritten record is the decay this tool exists to catch.
- The schedule-mode report shape changes: the pause block names a restart and no longer renders a resume-at line, and no `checkpointRefusal` line can appear because there is no checkpoint to refuse. That is a deliberate report-shape change this ADR covers, not silent drift.
- Stage 0's red-corpus attacks 1 and 2 move into the gate suite as passing regression guards: a checkpoint committed at the repo root does not suppress the sweep or inject a finding.
- One engine holds (PDR 2.8): the behavior is identical in PR mode and schedule mode; neither reads sweep state. The re-bill cost lands only on the schedule-mode sweep because that is the only mode that spans a quota window, but that is a property of when the modes run, not a fork in the code.
