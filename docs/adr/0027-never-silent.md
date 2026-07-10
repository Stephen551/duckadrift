---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0027: A broken watch goes red on every event; no event absorbs findings silently

## Status

Accepted — 2026-07-10.

## Context

An adversarial-round ledger entry stood open since v0.1.1: the action's failure
behavior was scoped by event, and the question — intended contract, or hole — was
never ruled. An event-by-outcome matrix built for this record settled what the code
actually did: crashes were already red on every event (the ADR-0013 backstop plus the
run step's shell strictness), but a push-triggered run with failing findings exited
green with no channel at all — annotations with no red, and no issue, because the
sweep runs only on schedule and dispatch. Findings on push were silently absorbed,
which the Pact names as its own violation class: the watch may pause visibly; it
never quietly stands down.

## Decision

Two rules, ruled by the director 2026-07-10:

1. A crash is never a finding. Any abnormal exit or missing-report state fails the
   job on every event, without exception.
2. No event silently absorbs failing findings. Pull requests fail red, as designed.
   Schedule and dispatch route to the issue channel and stay green — the issue is the
   interrupt. Every other event fails red, because it has no other honest channel.

The event-by-outcome matrix is committed as a permanent repro, and the action repros
are CI-wired from this release forward — a committed guard nothing executes is
untested in every configuration.

## Consequences

- A repository that wires the action to push events now gets gating there, matching
  what its findings already meant.
- The matrix pins the contract per event; a future event type must be placed in it
  deliberately rather than inheriting green by omission.
