---
status: accepted
date: 2026-04-04
severity: cosmetic
---

# ADR-0004: Log lines use lowercase level names

## Status

Accepted — 2026-04-04

## Context

`warn` versus `WARN` changes nothing an operator relies on. The decision is
declared cosmetic: a finding whose highest-severity cited decision is this one
must never be allowed to interrupt, whatever its confidence.

## Decision

Structured log level names are lowercase: `debug`, `info`, `warn`, `error`.

## Consequences

Level filters need no case folding. Nothing downstream breaks if one slips
through uppercase.
