---
date: 2025-01-01
review-by: 2025-06-01
# Status
---

# ADR-0001: Comment shapes

## Context

This record declares NO status anywhere. Its frontmatter carries an expired `review-by`, no `status:` field, and a YAML comment line reading `# Status`, which is commentary to the YAML parser but heading-shaped to a naive raw-text scan. The body's only status-shaped text is the quoted template below, inside a code fence:

```markdown
## Status

Accepted
```

The trap is the combination: a raw heading scan that counts the frontmatter comment desyncs from the parser's section candidates, and a fallback that then trusts the first candidate convicts this record on the fenced shadow. The oracle for this fixture is the empty array: every check stays silent.

## Decision

N/A. Fixture file.

## Consequences

N/A. Fixture file.
