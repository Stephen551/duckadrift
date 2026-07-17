---
date: 2026-05-05
governs:
  - src/api/**
---

# ADR-0001: API surface

## Context

This record declares NO status anywhere: no frontmatter `status:` field, no real Status heading section, no bold title-block line. The only status-shaped text is the quoted template below, inside a code fence:

```markdown
## Status

Accepted
```

It carries the same `governs:` globs as the heading-status fixture, so a fence-blind status read would make its governed path signal. The hardened recognizer refuses the fenced token, and the gate must stay silent on the same PR context that signals for the heading fixture.

## Decision

N/A. Fixture file.

## Consequences

N/A. Fixture file.
