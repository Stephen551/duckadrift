---
date: 2025-01-01
review-by: 2025-06-01
---

# ADR-0001: Review conventions

## Context

This record declares NO status anywhere: no frontmatter `status:` field, no real Status heading section, no bold title-block line. The only status-shaped text is the quoted template below, inside a code fence, documenting the convention this team asks authors to follow:

```markdown
## Status

Accepted
```

A fenced example is quoted text, not a declaration. The frontmatter carries an expired `review-by`, so a recognizer that reads the fenced heading as real falsely marks this record Accepted and D6 falsely fires. The oracle for this fixture is the empty array: every check stays silent.

## Decision

N/A. Fixture file.

## Consequences

N/A. Fixture file.
