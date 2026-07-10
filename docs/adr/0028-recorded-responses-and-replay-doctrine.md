---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0028: Recorded responses and the replay doctrine

## Status

Accepted — 2026-07-10.

## Context

The semantic tier calls a model; the development loop must not (PDR §2.10). The
standard failure of recorded-response testing is silent staleness: the prompt evolves,
the recording does not, and the suite keeps passing against a conversation the code no
longer has. That is a false green — the exact failure class this repository's test
doctrine exists to prevent, relocated into the test loop itself.

## Decision

Every Tier 1 check's CI assertion runs against a committed recording keyed by
`{backend, model, effort, checkId, promptHash}`, where `promptHash` is the hash of the
canonicalized request the check would send right now. Replay is refusal-first: a hash
mismatch fails the test loudly with a re-record instruction — a stale recording is
never silently replayed. Recordings carry a schema version and the digest of the exact
request they answered; live re-recording is a deliberate, credentialed act (a scheduled
job once checks exist), never part of the per-commit loop. The key deliberately mirrors
the calibration key of PDR §2.6: the same tuple that will gate thresholds gates
replay validity, so the test loop and the calibration doctrine cannot drift apart.

## Consequences

- The dev loop is deterministic and API-free; a prompt change surfaces as a red test
  naming the stale recording, not as quiet drift.
- Recordings are artifacts under review like oracles: changing one alongside a prompt
  change is expected; changing one to make a failing assertion pass without a prompt
  change is the self-sync failure ADR-0002 exists to stop, and the same discipline
  applies.
- The harness ships before any check does, proven against a hand-seeded recording —
  corpus and loop before code, at Tier 1 as at Tier 0.
