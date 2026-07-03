---
status: accepted
date: 2026-01-05
---

# ADR-0001: Monorepo package decision

## Status

Accepted — 2026-01-05

## Context

Reviewed by [Reviewer](@some-reviewer) — a bare GitHub-attribution mention, must
NOT be flagged. Also see [Unassigned](@) — an evidently unfilled attribution
slot, nothing after the `@`; this is NOT a valid handle either and must resolve
through normal existence checking (i.e. it must BE flagged, same as any other
target that doesn't exist).

## Decision

Depends on [the real plugin](@myscope/real-plugin), a scoped-package-style
target (`@scope/name`, written the way an npm/yarn workspace package is
referenced) that exists on disk at repo root — must NOT be flagged, proving
the tightened handle-only regex still lets real scoped paths through to
normal existence checking rather than blanket-skipping anything starting
with `@`.

Also depends on [the missing plugin](@myscope/missing-plugin), which does
not exist — the core seeded violation: a scoped-package-style target must
still be caught as dangling, not silently skipped as if it were a GitHub
mention just because it starts with `@`.

## Consequences

Three of the four links above resolve one way or another (bare mention skipped,
real scoped path exists); two do not resolve and are the seeded D3 violations
(`@` alone, and the missing scoped package).
