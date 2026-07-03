# ADR-0001: Loose-style decision missing context

- **Status:** Accepted 2026-01-05

Uses a bold Status line, no `## Status` heading, no YAML frontmatter —
loose dialect. Has a Decision but no Context/Problem-equivalent section,
reproducing a real external repo's shape from Gate G1 (ADRs 0023/0031-0034/0036).
Must surface as an advisory observation — never fail CI, never be
silently dropped (the original ADR-0004 draft asserted zero required
sections for loose and silently dropped this case entirely; corrected
per ADR-0005, which governs this exact scenario).

## Decision

Loose dialect, Decision present, Context/Problem absent.

## Consequences

None recorded.
