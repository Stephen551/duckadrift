---
status: accepted
date: 2026-07-09
severity: elevated
---

# ADR-0025: The D5 ack-source false positive

## Status

Accepted — 2026-07-09.

## Context

On the tool's own PR #27, during kill clause A's confirmation window, the dogfood run
emitted the first Tier 0 false positive found in the wild. D5 fired on three oracle
paths governed by ADR-0002 even though `ADR-ACK: 0002` stood as a standalone-line
trailer in a dedicated commit's message — the exact placement PDR §2.3 promises
("commit message or PR body") and the exact placement ADR-0002's own flow prescribes.

The engine was correct. The action wrapper was not: it populated the context field
named `commitMessage` with the pull request's title. The gate was structurally blind to
one of its two contracted acknowledgement surfaces, and the repository's own law
directed authors to put the marker precisely where the gate could not see it. The
finding was wrong in the world; which internal layer erred does not soften that. It is
recorded here as clause A's false positive number one — found by the dogfood loop doing
its job, triaged, root-caused, and fixed before any version carrying it was published.

## Decision

The wrapper collects the pull request's real commit messages over the same three-dot
merge-base range its changed-file derivation already uses, and passes them as
`commitMessage`. The title is deliberately excluded: it was never a contract surface,
and silently widening acknowledgement surfaces is the same failure class as silently
narrowing them. If message collection fails while the diff succeeded, the wrapper takes
the existing loud-degrade path — full-log mode, D5 skipped and stated — because a gate
blind to one of its acknowledgement surfaces must not gate at all: a wrongly-fired
siren is worse than a visibly skipped check.

A wrapper-level repro pins all three contracts permanently: a commit-message
acknowledgement satisfies the gate, an unacknowledged governed change still fails it,
and a title acknowledgement does not count.

## Consequences

- The gate's behavior matches the written contract on both surfaces; the repository's
  prescribed ADR-ACK flow works against its own gate.
- Clause A's ledger carries one false positive: found by dogfood on the tool's own
  pull request, not surviving triage, fixed in the same unreleased version. The
  confirmation record reports it verbatim.
- The verifier's checklist gains a permanent item: every pull-request verification
  includes the dogfood gate's own verdict on that pull request — the one path the
  eleven-probe engine verification of PR #27 did not exercise.
