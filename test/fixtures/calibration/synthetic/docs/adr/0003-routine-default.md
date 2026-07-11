---
status: accepted
date: 2026-04-03
---

# ADR-0003: Timestamps are stored in UTC

## Status

Accepted — 2026-04-03

## Context

Mixed local times in the store make every cross-region comparison a conversion
puzzle. This ADR declares no severity, so it takes the routine default — the
consequence axis the calibration harness must assign when frontmatter is silent.

## Decision

Every persisted timestamp is UTC. Localization happens at render time, from the
viewer's declared zone, never in the database.

## Consequences

Comparisons are direct. A row written in two regions sorts the same way in both.
