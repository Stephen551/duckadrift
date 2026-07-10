---
status: accepted
date: 2026-04-14
---

# ADR-0003: Commit subjects follow the conventional format

## Status

Accepted — 2026-04-14

## Context

Commit history was written in a mix of styles, which made changelog assembly and
history scanning slower than it needed to be.

## Decision

Commit subjects use the conventional `type: summary` format, present tense,
lower-case type token, no trailing period.

## Consequences

Changelog tooling can group commits mechanically. Contributors learn one small
convention at onboarding.
