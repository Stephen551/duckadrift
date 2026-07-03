---
status: accepted
date: 2026-01-05
---

# ADR-0001: Missing context, no declared dialect

## Status

Accepted — 2026-01-05

## Decision

This ADR has no Context or Problem section, and this fixture has no
`.duckadrift.yml` declaring a dialect. Seeded violation: the missing-
section claim must be advisory only (ADR-0005) — informational, never
CI-failing — since the dialect here is guessed, not user-declared.

## Consequences

None recorded — negative-for-CI-failure is the point of this fixture.
