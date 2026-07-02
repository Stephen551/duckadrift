---
status: accepted
date: 2026-01-05
---

# ADR-0001: Decision with broken links

## Status

Accepted — 2026-01-05

## Context

References another ADR that does not exist: [ADR-0099](0099-nonexistent.md).

## Decision

Implemented in [the pipeline module](../../src/pipeline/color.ts), which does not exist in this fixture.

## Consequences

Both links above are seeded violations: reference integrity (D3). Neither the target ADR file nor the target source file resolves at HEAD.
