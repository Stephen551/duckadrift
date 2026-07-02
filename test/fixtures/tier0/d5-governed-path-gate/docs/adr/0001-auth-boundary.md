---
status: accepted
date: 2026-01-05
governs:
  - "src/auth/**"
---

# ADR-0001: Auth boundary

## Status

Accepted — 2026-01-05

## Context

Establishes `src/auth/**` as a governed path: changes there must acknowledge this decision.

## Decision

Any PR touching `src/auth/**` must either modify this ADR or carry an `ADR-ACK: 0001` override marker in the commit message or PR body.

## Consequences

A PR that silently touches `src/auth/**` without either is the seeded violation (D5) — see `pr-context.json` in this fixture.
