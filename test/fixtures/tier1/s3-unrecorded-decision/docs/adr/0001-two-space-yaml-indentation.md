---
status: accepted
date: 2026-02-11
---

# ADR-0001: YAML files use two-space indentation

## Status

Accepted — 2026-02-11

## Context

Config files arrived with mixed indentation, and review comments kept relitigating
formatting instead of content.

## Decision

Every YAML file in the repository uses two-space indentation, enforced by the
formatter configuration.

## Consequences

Formatting is mechanical and out of review scope. No file in the repository
declares any other convention.
