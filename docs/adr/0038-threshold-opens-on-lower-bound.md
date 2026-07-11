---
status: accepted
date: 2026-07-11
severity: elevated
---

# ADR-0038: A threshold opens on the lower bound, never the point estimate

## Status

Accepted — 2026-07-11.

## Context

The calibration harness turns chosen precision floors into measured confidence thresholds.
The first labeled corpus this project can afford is small, and a precision measured on a
small sample carries a wide interval: a point estimate can clear a floor by luck while the
true precision sits below it. A siren opened on that number is wrong in exactly the way
the founding decision forbids. The specification's original schema carried thresholds and
a curve; it did not carry the statistical honesty a small corpus demands.

## Decision

A severity's interrupt threshold is the smallest reported-confidence value whose cohort
meets the severity's precision floor with the Wilson 95% lower confidence bound above the
floor — never the point estimate alone. Where no cohort achieves that, the entry records
the threshold as null, the interrupt channel stays closed for that severity, and the
report says so per severity with the measured curve as evidence. A calibration whose every
threshold is null is still a real, publishable calibration: it is the honest statement
that the corpus must grow, with the required growth visible in the curve itself.

The calibration entry also derives each labeled finding's severity deterministically as
the maximum severity among the decision records its citations name, defaulting to routine
where a record declares none and where a finding cites no record at all. The consequence
axis attaches to the highest-stakes decision a finding implicates and is never diluted by
a lower-severity co-citation.

Every labeled finding enters the curve through a strict review file: a label is exactly
true or false, and a missing, malformed, or ambiguous label fails the entire fit rather
than silently dropping or defaulting the finding. The labels are the moat; the harness
refuses to guess them.

## Consequences

- The interrupt channel can only open on statistical sufficiency the curve itself
  demonstrates, and the published curve carries the evidence for every threshold and every
  closure alike.
- Small-corpus luck cannot open a siren: the plan's central test case — a tiny cohort
  whose point precision clears a floor while its lower bound does not — yields a closed
  channel by construction.
- The floors remain chosen tolerances, recorded as named constants with their source; the
  thresholds remain measured artifacts, computed by the harness and never typed.
- Growth is measurable: each per-severity entry names its sample size and bound, so "how
  many more labeled findings until this floor can open" is an arithmetic question, not a
  judgment call.
