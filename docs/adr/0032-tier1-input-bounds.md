---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0032: Tier 1 input bounds — a log too large to read is skipped aloud, never trimmed in silence

## Status

Accepted — 2026-07-10.

## Context

Full-log semantic checks read every Accepted record verbatim, and real logs
outgrow a single model call: one external corpus member measures 689KB of ADR
markdown, past any responsible single-request budget once the instruction
prefix and response headroom are counted. Something must give, and the failure
modes differ sharply in honesty. Silent truncation reads part of the log and
reports as if it read it all — a partial watch presented as a full one, the
exact lie this tool exists to catch. A loud skip reads nothing and says so.

## Decision

Full-log checks carry a provisional input cap, a named constant of 600,000
document bytes. A selection that would exceed it is not sent, not trimmed, and
not sampled: the check is skipped, and the skip is reported in the annex and
the machine report with the measured size and the cap, as its own skip reason
distinct from having nothing to read. The constant is provisional in the
calibration sense — chosen from measurement of the current corpus and model
context, to be re-derived when the calibration milestone measures real token
budgets. The successor is named now so the cap is a stage, not a ceiling:
batched selection, in which oversized logs are read in deterministic groups
across multiple calls and the findings merged, arrives with the calibration
work that can price it.

## Consequences

- A repository whose log exceeds the cap gets full Tier 0 coverage and a
  clearly stated Tier 1 gap, instead of semantic findings quietly computed
  from a fraction of its decisions.
- The cap is a single shared constant consumed by every full-log selector —
  one primitive, per this repository's standing law.
- The skip reason vocabulary grows by one entry, and every consumer of the
  machine report can distinguish "nothing to read" from "too much to read in
  one call."
