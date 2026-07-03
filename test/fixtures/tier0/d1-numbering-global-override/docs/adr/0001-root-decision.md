---
status: accepted
date: 2026-01-05
---

# ADR-0001: Root decision

## Status

Accepted — 2026-01-05

## Context

A well-formed decision at the ADR root, number 0001.

## Decision

Use this as one half of a cross-directory duplicate-number pair — the other
half lives in `team-a/`, also numbered 0001. This repo declares
`numbering: global` in `.duckadrift.yml`, so the cross-directory collision
is upgraded back to fact-tier — proving the escape hatch actually restores
the pre-ADR-0008 behavior, not just that it's silently ignored.

## Consequences

None beyond the seeded D1 duplicate-number violation.
