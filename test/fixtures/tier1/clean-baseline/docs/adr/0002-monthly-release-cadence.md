---
status: accepted
date: 2026-03-09
---

# ADR-0002: Releases ship on a monthly cadence

## Status

Accepted — 2026-03-09

## Context

Releases were cut whenever a feature felt done, which made downstream planning
guesswork and bunched review load unpredictably.

## Decision

Cut a release on the first Tuesday of each month. Whatever is merged by then ships;
whatever is not waits for the next cycle.

## Consequences

Downstream consumers can plan upgrades. Urgent fixes still ship as out-of-band
patches when needed.
