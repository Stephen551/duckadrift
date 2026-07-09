---
status: accepted
date: 2026-07-09
severity: elevated
---

# ADR-0024: Basename advisories name every candidate, not just the first

## Status

Accepted — 2026-07-09.

## Context

ADR-0011 created the site-relative advisory: an extensionless link that resolves only
by basename is provably real but not provably an error, so it surfaces as an advisory
with the discovered path folded in. The finder behind it kept only the first file per
basename, so when several files shared the linked basename the advisory pointed at one
of them as if it were the only one. Issue #8 named the cost: a reader jumping to the
named file may be jumping to the wrong file, and the advisory gave no signal that a
choice existed.

## Decision

The basename finder indexes every file per basename in deterministic walk order. The
primary resolution is unchanged — the same first-in-walk-order file as before — and the
site-relative advisory's claim now appends the other candidates, sorted, capped at
three named plus a count. When the basename is unique, the claim is byte-identical to
its previous form; the suffix exists only when a choice exists.

## Consequences

- The advisory now carries the full state of the ambiguity it reports, per the finding
  contract: a reader can see every candidate without re-deriving the search.
- Every existing oracle and report on unique-basename trees is unchanged by
  construction — the no-suffix case is the old string.
- Report determinism (§3.2) holds: candidates are lexicographically sorted and the
  primary selection rule is unchanged.
