---
date: 2025-01-01
review-by: 2025-06-01
---

# ADR-0001: Authoring template

## Context

This record declares NO status anywhere: no frontmatter `status:` field, no Status heading section, no bold title-block line of its own. The only status-shaped text is the quoted template below, inside a code fence, showing the loose-dialect line this team's authoring guide documents:

```markdown
- **Status:** Accepted
```

A fenced example is quoted text, not a declaration. The frontmatter carries an expired `review-by`, so a recognizer whose bold-line scan is fence-blind falsely marks this record Accepted and D6 falsely fires. The oracle for this fixture is the empty array: every check stays silent.

## Decision

N/A. Fixture file.

## Consequences

N/A. Fixture file.
