---
date: 2026-05-05
governs:
  - src/api/**
---

# ADR-0001: API surface

## Status

Accepted

## Context

This record declares its status through a `## Status` heading section, the original ADR form's own canonical dialect, while its frontmatter carries only the `governs:` globs and a date. It is the relevance-gate analog of the Tier 0 D5 fixture: a wild-dialect Accepted decision governing `src/api/**` that a frontmatter-only status read cannot see, so a PR touching the governed path produced no Tier 1 signal at all.

## Decision

Changes under `src/api/**` are governed by this decision and are exactly what the semantic tier should read.

## Consequences

A PR touching the governed path must produce a governed-path signal once status is read through the shared recognizer.
