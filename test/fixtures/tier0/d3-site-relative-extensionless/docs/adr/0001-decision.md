---
status: accepted
date: 2026-01-05
---

# ADR-0001: Decision with extensionless, trailing-slash site-relative links

## Status

Accepted — 2026-01-05

## Context

Three links, all trailing-slash and extensionless — the dominant MkDocs/Docusaurus
"pretty URL" idiom (found running R5's edgex-docs, caught in verifier review: a
plain basename split on a trailing-slash target returns an empty string, silently
matching nothing).

Links to [decision A](../../other/decision-a/), whose real source is
`other/decision-a.md` — found via the `.md`-completion candidate.

Links to [decision B](../../nonexistent-path/decision-b/), whose real source lives
at `elsewhere/decision-b/index.md` — deliberately unreachable via any correct
relative-path depth, so primary resolution genuinely fails and this is found only
via the `<slug>/index.md` fallback candidate.

## Decision

Also links to [decision C](../../other/decision-c/), which has no match anywhere in
the tree under any candidate — the negative control, must stay fact even after
normalization.

## Consequences

Two of the three links above resolve via the new normalization (advisory, each);
the third has no match anywhere and stays fact.
