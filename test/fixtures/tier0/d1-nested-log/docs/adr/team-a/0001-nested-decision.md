---
status: accepted
date: 2026-01-06
---

# ADR-0001: Nested decision

## Status

Accepted — 2026-01-06

## Context

A well-formed decision inside a per-team subdirectory, `team-a/`, also
numbered 0001 — a real, common shape (found running R5's opendatahub,
whose actual ADRs live under operator/, mlflow/, autox/, and similar
per-team directories the pre-ADR-0007 loader never saw at all).

## Decision

Use this as the other half of the cross-directory duplicate-number pair.
Only detectable if ADR discovery recurses into `team-a/` in the first place.

## Consequences

None beyond the seeded D1 duplicate-number violation.
