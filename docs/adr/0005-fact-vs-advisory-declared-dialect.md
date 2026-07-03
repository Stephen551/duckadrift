---
status: accepted
date: 2026-07-02
severity: critical
---

# ADR-0005: Fact-vs-advisory — structural claims require a declared dialect

## Status

Accepted — 2026-07-02

## Context

Even with ADR-0004's widened detection, dialect auto-detection is a guess, not an observation. Nine of nine "missing Context" findings from one real external repo were verdicted FALSE by the director in Gate G1's kill-clause-A rehearsal. The Pact (ADR-0001) requires Tier 0 to be provably false-positive-free by construction — asserting a guessed classification as unconditional fact is exactly the kind of confident-but-wrong claim that requirement forbids.

## Decision

D1's "missing required section" claim carries `advisory: true` unless the repo's `.duckadrift.yml` explicitly declares its `dialect`. Advisory findings still surface in the report — surfaced, never suppressed, per the Pact's every-finding-is-surfaced clause — but never fail CI; `duckadrift check`'s exit code only counts non-advisory findings. When a dialect is declared, the same claim is fact as before: declaration overrides per-file auto-detection for every ADR in the repo, and the claim can fail CI exactly as it always could.

This is Tier 0's first exception to "every finding is asserted as fact." It exists because dialect is the one thing D1 checks that duckadrift cannot observe directly — it infers a template the author never stated. It does not weaken the Pact's Clause 2 (only deterministic, provable checks may fail CI): the check is still fully deterministic, and the exception narrows precisely to the one input duckadrift is guessing rather than reading. Every other D1 sub-check (duplicate numbering, skipped numbering, malformed status) verifies something objectively present in the file, not an inferred intent, and stays fact-always.

## Consequences

- `.duckadrift.yml`'s `dialect:` field is no longer merely documented — declaring it is now the only way to get CI-failing structural-completeness enforcement from D1.
- This is a narrow, one-check exception, not a general precedent for downgrading Tier 0 to advisory-unless-declared. A future check considering the same move needs its own ADR making the same case: that it rests on inferred intent duckadrift cannot verify, the way dialect is.
- Every future check inherits the discipline this clause implies: don't assert what duckadrift is guessing at.
