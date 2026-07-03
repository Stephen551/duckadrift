---
status: accepted
date: 2026-01-05
---

# ADR-0001: Example decision

## Status

Accepted — 2026-01-05

## Context

This repo keeps its ADR log at `decisions/`, not `docs/adr` or `doc/adr` —
seeds the `--adr-dir` override path, not any Tier 0 check.

## Decision

Use this as the fixture for `resolveAdrDir`'s override behavior.

## Consequences

None — this fixture is not part of the Tier 0 corpus and has no
expected-findings.json.
