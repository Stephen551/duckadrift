---
status: accepted
date: 2026-07-11
severity: elevated
---

# ADR-0041: The corpus diffs are real — commit history as the pull-request proxy

## Status

Accepted — 2026-07-11.

## Context

Calibrating the diff-mode checks requires diffs, and the corpus repositories offer two
possible sources: scenarios invented for the purpose, or the history of changes that
actually happened. A threshold fitted to invented scenarios measures the checks against
our own imagination — the typed number the specification forbids, one layer up. The
director ruled for history. What remained was to fix the proxy and the selection so the
corpus construction is itself auditable.

## Decision

A historical commit stands proxy for a pull request: its changed files are the diff-tree
against its first parent, and the repository context is the tree as it stood at that
commit, reconstructed in a guarded worktree that refuses to capture at any other state.
Candidates are selected deterministically — newest first along the first-parent line,
capped per repository and per check, every selected commit recorded — so the same rule
reproduces the same corpus. An unrecorded-decision candidate is a commit that touched a
dependency manifest or storage schema and no decision record; a code-versus-decision
candidate is a commit that touched files governed by a record Accepted at that commit,
read from that commit's tree and not today's. The governs convention exists only in this
repository's own log, so the code-versus-decision harvest is thin by fact, not by choice,
and the diff-mode corpus is dominated by the unrecorded-decision check; its findings cite
no decision record and so carry routine severity. The corpus this milestone feeds is
therefore chiefly the routine floor's, and the other floors open only if the whole-log
corpus earns them — or stay closed, which the calibration doctrine treats as a publishable
answer rather than a failure.

## Consequences

- Every threshold fitted from this corpus traces to commits that exist in public history
  or in the director's private repositories, selected by a stated rule anyone can re-run.
- The pull-request proxy is honest about its limit: a squashed or rebased history shows
  coarser diffs than the original pull requests did, and the harvest table records which
  repositories that caveat touches.
- The capture inherits every prior discipline unchanged: checkpointed, synchronous,
  privacy-split, probe-priced before committed spend, stopped by a projection gate rather
  than an empty key.
