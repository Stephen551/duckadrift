---
status: accepted
date: 2026-07-11
severity: elevated
---

# ADR-0040: The calibration corpus splits at the privacy boundary

## Status

Accepted — 2026-07-11.

## Context

The calibration corpus is captured from nine repositories, two of them private. A captured
recording carries the full text of the decision records it inspected, and the labeling
review file quotes that text as evidence. Committing either for a private repository would
publish the exact content this repository's privacy guard exists to block. The corpus
also must remain traceable: a calibration entry hashes the labeled set it was fitted from,
and that trace has to survive the split.

## Decision

Corpus artifacts divide at the privacy boundary. Recordings, usage records, and review
files from public repositories are committed; the same artifacts from private repositories
exist only on the director's machine under a gitignored corpus directory whose ignore rule
ships before the first private byte is captured. Committed prose refers to the private
repositories only by their established generic names. The calibration file itself —
thresholds, curves, sample sizes, and the corpus hash — contains no decision-record text
and is committed, so every published threshold remains traceable to the labeled set that
produced it even where part of that set cannot be published. Capture runs synchronously
through the same transport the runner replays: a batch-shaped recording would not replay
through the shipped parse path, and a corpus the test loop cannot replay is not a corpus.

## Consequences

- No private decision text can reach the public repository through the calibration
  pipeline; the boundary is structural (separate directories, one gitignored), not
  procedural.
- The published calibration remains fully traceable by hash while part of its labeled
  corpus stays private; an outside verifier can confirm the public subset and the
  arithmetic, and the director holds the private remainder.
- The corpus is replay-valid by construction: one transport shape, captured once,
  checkpointed, never re-paid.
- Growth of the corpus inherits the split automatically: future private captures land on
  the private side without a new decision.
