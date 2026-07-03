---
status: accepted
date: 2026-01-05
---

# ADR-0001: Decision with a reviewer table

## Status

Accepted — 2026-01-05

|          |                                      |
| -------- | ------------------------------------ |
| Reviewed | [Jane Doe](jane.doe@example.com)     |

## Context

References a real ADR that does not exist: [ADR-0099](0099-nonexistent.md). Seeded violation: reference integrity (D3).

## Decision

N/A — fixture file.

## Consequences

None beyond the seeded D3 violation above. The reviewer-table entry above is
a bare-email attribution idiom found running R5's opendatahub (no `mailto:`
scheme, just the address as the link target), not a file or code reference,
and must NOT be flagged.
