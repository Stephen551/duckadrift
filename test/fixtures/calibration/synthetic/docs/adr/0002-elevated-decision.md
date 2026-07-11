---
status: accepted
date: 2026-04-02
severity: elevated
---

# ADR-0002: All inter-service calls carry a propagated trace id

## Status

Accepted — 2026-04-02

## Context

An incident with no correlated trace is debugged by guesswork. Losing the trace
id is not catastrophic, but it degrades every investigation that follows, so the
decision is declared elevated rather than routine.

## Decision

Every service reads the inbound `trace-id` header and forwards it on every
downstream call. A request that arrives without one is assigned a fresh id at
the edge, never in the interior.

## Consequences

One log field ties a request's whole path together. A service that drops the
header silently blinds everything behind it.
