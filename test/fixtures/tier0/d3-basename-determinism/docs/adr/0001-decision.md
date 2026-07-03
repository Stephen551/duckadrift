---
status: accepted
date: 2026-01-05
---

# ADR-0001: Decision citing a basename that exists in two directories

## Status

Accepted — 2026-01-05

## Context

Real-world duckadrift runs against cosmos-sdk surfaced a live case: the tree
contains two files both named `module.proto`, in different directories. A
site-relative dangling link's basename fallback (ADR-0011) has to pick one to
report as evidence — and the choice must be the same file on every machine,
not whichever `readdirSync` happens to visit first (a determinism violation
against this project's own byte-identical-report guarantee, PDR §3.2).

Links to [the shared schema](../../missing/shared-config.proto), which does
not resolve at HEAD directly. Two files share that exact basename, in `aaa/`
and `zzz/` — the walker's per-directory sort must pin evidence to
`aaa/shared-config.proto`, the lexicographically first, every time.

## Decision

Evidence for this finding must always cite `aaa/shared-config.proto`, never
`zzz/shared-config.proto`, regardless of the host filesystem's native
directory-entry order.

## Consequences

A flaky evidence path here would mean two runs of duckadrift against the same
commit could produce different reports for the exact same tree — the exact
failure this fixture pins down.
