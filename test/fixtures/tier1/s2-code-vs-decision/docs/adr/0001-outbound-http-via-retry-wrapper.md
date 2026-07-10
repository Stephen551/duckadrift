---
status: accepted
date: 2026-05-05
governs:
  - src/net/**
---

# ADR-0001: Every outbound HTTP call goes through the retry wrapper

## Status

Accepted — 2026-05-05

## Context

Transient upstream failures were handled ad hoc, with each call site inventing
its own retry loop or none at all. Timeout, backoff, and retry budgets belong in
one place so they can be tuned once and observed once.

## Decision

Every outbound HTTP call goes through the retry wrapper in `src/net/wrapper.ts`;
direct fetch calls are prohibited in governed paths.

## Consequences

Retry policy changes are one-file edits. New network code pays a small
indirection cost and inherits backoff behavior for free.
