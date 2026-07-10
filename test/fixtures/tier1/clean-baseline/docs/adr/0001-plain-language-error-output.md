---
status: accepted
date: 2026-02-02
---

# ADR-0001: Error output names the failure and the fix

## Status

Accepted — 2026-02-02

## Context

Early error output mixed stack traces with vague summaries, and support requests
showed users could not act on either.

## Decision

Every user-facing error message states what failed and what to do next, in one
sentence each. Stack traces go to the debug log only.

## Consequences

Support requests can quote a single actionable line. Message writing takes slightly
longer at authoring time.
