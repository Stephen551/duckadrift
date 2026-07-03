---
status: accepted
date: 2026-01-05
---

# ADR-0001: Root decision

## Status

Accepted — 2026-01-05

## Context

A well-formed decision at the ADR root, number 0001.

## Decision

Use this as one half of a cross-directory duplicate-number pair — the other
half lives in `team-a/`, also numbered 0001. If ADR discovery does not
recurse into subdirectories (ADR-0007), the nested file is invisible and no
duplicate is ever detected — this fixture goes red exactly that way against
pre-recursion code. Since the pair spans two different directories, the
finding is advisory by default (ADR-0008: a per-directory numbering
namespace) — this also proves recursion is still what makes the finding
possible at all; the tier just changed from fact to advisory.

## Consequences

None beyond the seeded D1 duplicate-number violation.
