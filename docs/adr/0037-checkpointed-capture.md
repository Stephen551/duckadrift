---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0037: Checkpointed capture — a paid recording is written once and never re-paid

## Status

Accepted — 2026-07-10.

## Context

Recordings were produced ad hoc through the semantic-tier build: a throwaway script per
milestone, run once, its output committed by hand. Calibration is different in kind. It
makes hundreds of paid model calls against a finite balance, over a run long enough to be
interrupted — a dropped connection, an exhausted credit, a killed process. A capture path
that loses already-purchased recordings on interruption, or re-pays for them on restart,
turns a bounded cost into an unbounded one. The measurement probe that precedes
calibration needs the same durability, at small scale, so the primitive is built and
proven before the money is committed.

## Decision

Capture writes each recording to disk the instant its call returns, before the next call
begins, keyed by the ADR-0028 tuple — `{backend, model, effort, checkId, promptHash}` —
the exact key replay validates against. On restart, an existing recording whose promptHash
matches the request the capture would send is a completed checkpoint: the call is skipped,
no request is made, and nothing is spent. A recording whose hash no longer matches is
stale by the same doctrine that governs replay and is re-captured, not silently trusted.
The measured usage block is persisted beside each recording, so cost is computed from
observed tokens rather than re-derived. A transport error during a run is loud and
non-fatal to the artifacts: every recording already written is intact, the run exits
non-zero naming where it stopped, and re-running resumes from the next uncaptured call —
the quota-exhaustion doctrine of the Pact, applied to the act of buying recordings.

The path is separate from the verdict commands. It makes live paid calls, so it never
sits on `check` or `report`; it is its own command, reusing each check's own input
selector, the shared prompt builder, and the recording contract, forking none of them.

## Consequences

- Calibration can be interrupted and resumed without re-paying for a captured finding, and
  a run against a dying balance loses nothing already bought.
- The capture primitive lands before calibration and independently of it: a small,
  testable tool proven API-free against a stub transport, so the checkpoint's zero-call
  resume is a unit fact, not a hope observed once on a live run.
- Cost is always computed from the usage block persisted with each recording — measured,
  never estimated, as the trust posture requires.
