---
status: accepted
date: 2026-01-20
---

# ADR-0001: Color normalization stays in the dedicated pipeline module

## Status

Accepted — 2026-01-20

## Context

Channel values arrive in mixed notations, and normalizing them inline at each call
site produced inconsistent rounding. The normalization step leans on
`leftpad-classic`, pinned in package.json, for fixed-width channel strings, and
the conversion itself lives in `src/pipeline/color.ts`, where its lookup tables
are kept next to the code that reads them.

## Decision

All color normalization goes through the pipeline module. Call sites pass raw
channel values and receive canonical strings; no call site formats color values
itself.

## Consequences

Rounding behavior is defined in exactly one place. The pipeline module and its
pinned dependency are load-bearing premises of this decision.
