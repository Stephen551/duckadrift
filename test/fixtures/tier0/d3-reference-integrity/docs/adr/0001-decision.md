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

Also see [the real file](src/real-file.ts), cited repo-root-relative style — this one exists and must NOT be flagged; it only resolves via the repo-root-relative fallback (ADR-dir-relative would look for `docs/adr/src/real-file.ts`, which doesn't exist).

## Consequences

The first two links above are seeded violations: reference integrity (D3). Neither the target ADR file nor the target source file resolves at HEAD. The third link is a seeded negative case: it resolves via the repo-root-relative fallback and must not be flagged.
