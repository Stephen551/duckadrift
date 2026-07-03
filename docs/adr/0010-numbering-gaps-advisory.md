---
status: accepted
date: 2026-07-03
severity: elevated
---

# ADR-0010: Numbering gaps are advisory by default

## Status

Accepted — 2026-07-03.

## Context

Doctrine Q1 (R5's triage doc): D1's skip-numbering check fired 32 times across
cosmos-sdk (15) and edgex-docs (18, before ADR-0007's recursion fix folded most of
them back into real files) — the overwhelming majority of both repos' non-clean
findings. Every one of those claims is factually accurate: the number genuinely
doesn't exist as a file. But in real, mature ADR logs, numbers retire legitimately —
a withdrawn proposal, a renumbering, a decision merged into another one — and nothing
about a gap alone proves an error occurred. A gap is a provable *state*, not a
provable *error*.

## Decision

A numbering-gap finding is advisory by default: surfaced, never failing CI on its
own. A new config key, `numbering_gaps: advisory | fail` (default `advisory`), lets
a repo declare it wants gaps caught as errors — declaring `fail` restores the
original hard-fail behavior exactly.

## Consequences

- Every existing numbering-skip finding in every fixture and every R5 repo becomes
  advisory unless a repo declares `numbering_gaps: fail`.
- The pre-existing `d1-schema-lint` fixture's skip-numbering finding is now
  advisory — a wording-preserving, tier-only oracle change (claim, evidence, and
  consequence text are unchanged; only `advisory: true` is added).
- A new fixture, `d1-numbering-gaps-strict`, proves the `fail` override actually
  restores fact-tier, not merely that the config key is silently ignored.
- Doctrine Q1 is resolved by this ADR: this was the "should a gap unconditionally
  fail CI" half of that question. It does not address whether skip-detection should
  additionally scope to changed files in PR-diff mode — that remains open if it
  comes up again.
