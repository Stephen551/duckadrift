---
date: 2026-01-05
governs:
  - "src/api/**"
---

# ADR-0001: API surface

## Status

Accepted

## Context

This record declares its status through a `## Status` heading section, the original ADR form's own canonical dialect. Its frontmatter carries the `governs:` globs but no `status:` field, the incremental-adoption pattern PDR 2.2 describes. Establishes `src/api/**` as a governed path: changes there must acknowledge this decision.

## Decision

Any PR touching `src/api/**` must either modify this ADR or carry an `ADR-ACK: 0001` override marker in the commit message or PR body.

## Consequences

A PR that silently touches `src/api/**` without either is the seeded violation (D5), visible only when accepted-ness is read from the heading dialect. See `pr-context.json` in this fixture.
