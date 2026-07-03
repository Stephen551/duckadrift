---
status: accepted
date: 2026-01-05
---

# ADR-0001: Comment-embedded example links

## Status

Accepted — 2026-01-05

## Change Log
<!--
List the changes to the document, incl. state, date, and PR URL.
E.g.:
- [approved](URL of PR) (2022-04-01)
- [amended](URL of PR) (2022-05-01)
-->

## Context

References a real ADR that does not exist: [ADR-0099](0099-nonexistent.md). Seeded violation: reference integrity (D3).

## Decision

N/A — fixture file.

## Consequences

None beyond the seeded D3 violation above. The template-example links inside the
`<!-- -->` block under Change Log (`URL of PR`, twice) are invisible instructional
boilerplate, found running R5's edgex-docs, and must NOT be flagged — HTML
comments are stripped before section/link parsing.
