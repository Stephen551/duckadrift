---
status: accepted
date: 2026-01-05
---

# ADR-0001: Decision with an authors table

## Status

Accepted — 2026-01-05

|         |                                |
| ------- | ------------------------------ |
| Authors | [Jane Doe](@janedoe-example)   |

## Context

References a real ADR that does not exist: [ADR-0099](0099-nonexistent.md). Seeded violation: reference integrity (D3).

## Decision

N/A — fixture file.

## Consequences

None beyond the seeded D3 violation above. The Authors-table entry above is a
GitHub-attribution-mention idiom found running R5's opendatahub (a name linked
to an @-prefixed handle), not a file or code reference, and must NOT be flagged.
