---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0030: The parity guard gains an auditable override

## Status

Accepted — 2026-07-10.

## Context

ADR-0027's parity guard mechanically requires every change under `src/checks/` to
ship alongside a Tier 0 fixture change — the fixture-in-the-same-PR rule, enforced.
The rule guards behavior changes, but the guard can only see file paths. PR #32
produced the legitimate case the mechanism cannot express: a behavior-identical
extraction of the governed-path matcher whose correctness proof is precisely that
the fixture diff is empty. Both constraints were honored and the guard fired because
they were.

This repository already ruled on gates without escape hatches: D5 ships with ADR-ACK
because a gate that cannot admit a legitimate exception auditably is a gate teams
disable — or merge over red, which is the same disability arriving one waiver at a
time (PDR §2.3).

## Decision

The parity guard accepts an override: an anchored whole line of the form
`PARITY-ACK: <reason>`, with a mandatory non-empty reason, in a commit message body
or the pull request body. The anchoring imports ADR-ACK's B-5 lesson verbatim — an
incidental prose mention never acks a gate. An accepted override is printed into the
run log with the matched line, so the exception is recorded where the enforcement
happened, not silently absorbed. The pull request body reaches the script through
the workflow's environment block, never by direct interpolation, because that body
is attacker-authorable on fork pull requests and an interpolated string is a shell.

The guard's trigger is unchanged: the override is consulted only when check logic
changes without a Tier 0 fixture change. Fixture-accompanied changes never need it.

## Consequences

- Behavior-identical refactors and shared-primitive consolidations — a recurring
  shape as of the adversarial-consolidation round, and by construction during
  M3/M4 — pass the guard by declaring themselves, on the record, instead of by
  merging over a red check and teaching the repository that red is sometimes
  ignorable.
- The override is auditable twice: the marker lives in git history or the PR body,
  and the acceptance is echoed in the run log.
- A reason is mandatory. The guard does not evaluate the reason's quality — the
  reviewer does; the guard's job is to make sure there is one to review.
