---
status: accepted
date: 2026-01-05
---

# ADR-0001: Decision with a leading-slash link

## Status

Accepted — 2026-01-05

## Context

Links to [the target decision](/docs/adr/0002-target.md), a GitHub-style
repo-root-relative reference (leading slash, found running R5's
opendatahub) — this resolves and must NOT be flagged.

## Decision

Also links to [a missing decision](/docs/adr/0099-missing.md), the same
leading-slash convention, but this target genuinely does not exist. Seeded
violation: reference integrity (D3).

## Consequences

One of the two leading-slash links above resolves (must not be flagged);
the other is the seeded D3 violation.
