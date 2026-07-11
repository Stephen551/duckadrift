---
status: superseded
date: 2026-07-11
---

# ADR-0007: Frontmatter superseded, heading says accepted

## Status

Accepted

## Context

A record that declares status in BOTH frontmatter (superseded) and a heading
(accepted). Declared-first wins: frontmatter is read, the heading never overrides
it. This is the precedence guarantee — the resolver is not a max or a vote.

## Decision

Resolve to superseded from the frontmatter source; not accepted.
