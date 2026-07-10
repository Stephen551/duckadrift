---
status: accepted
date: 2026-02-14
---

# ADR-0001: Background work rides the embedded queue

## Status

Accepted — 2026-02-14

## Context

Background jobs were spawned ad hoc with no retry story. The team weighed an
external broker against an embedded queue table and chose the smaller
operational surface.

## Decision

All background work goes through the embedded queue table; workers poll it with
a five-second interval and jobs carry an attempts counter capped at five.

## Consequences

One storage engine to operate. Throughput is bounded by the polling interval,
which is acceptable at current volume.
