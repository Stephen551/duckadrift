---
status: accepted
date: 2026-04-20
---

# ADR-0002: Log lines are structured JSON on stderr

## Status

Accepted — 2026-04-20

## Context

Freeform log strings made field debugging a grep-and-guess exercise, and support
kept asking customers to re-run with different verbosity.

## Decision

Every log line is a single JSON object written to stderr, with `level`, `event`,
and `ts` fields always present. Human-readable rendering is a viewer concern,
not a writer concern.

## Consequences

Field logs are machine-filterable as delivered. The write path pays a small
serialization cost on every line.
