---
status: accepted
date: 2026-01-05
---

# ADR-0001: Decision with a site-relative-shaped dangling link

## Status

Accepted — 2026-01-05

## Context

Links to [the color module](../../src/pipeline/color.ts), which doesn't
resolve at that path under either ADR-dir-relative or repo-root-relative
reading — but a file named `color.ts` genuinely exists elsewhere in this
repo, at `lib/render/color.ts` (found running R5: edgex-docs and cosmos-sdk
both had a link written for a published doc site's URL depth, not the raw
git tree). Seeded ADR-0011 violation: must surface as advisory, with the
discovered path folded into the finding, not as an unqualified dangling
reference.

## Decision

Also links to [a genuinely missing file](nothing-anywhere-in-this-repo.ts),
which has no match anywhere in the tree — the negative control, must stay
fact.

## Consequences

One of the two links above resolves nowhere but has a same-basename match
elsewhere (advisory); the other has no match anywhere and stays fact.
