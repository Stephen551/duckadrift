---
status: accepted
date: 2026-03-20
---

# ADR-0002: Configuration is static at process start

## Status

Accepted — 2026-03-20

## Context

Hot-reloading configuration produced states no test had ever run. Restarts are
cheap for this service; half-applied config is not.

## Decision

Configuration is read once at process start and never reloaded; changing any
value means restarting the process.

## Consequences

Every running process has a config that some test suite has seen in full. Config
changes take a restart, which the deploy tooling already performs.
