---
status: accepted
date: 2026-06-15
---

# ADR-0003: PostgreSQL is the system of record

## Status

Accepted — 2026-06-15

## Context

Reporting queries and concurrent writers have outgrown what a single-writer
storage layer handles comfortably, and the team already operates PostgreSQL for
two other products.

## Decision

Adopt PostgreSQL as the system of record for all persistence. The database runs
as a managed cluster; the application authenticates with rotating credentials
and connects over TLS.

## Consequences

Reporting moves to SQL views maintained with migrations. Operations inherit the
cluster's patch and failover schedule.
