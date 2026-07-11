---
status: accepted
date: 2026-07-11
severity: elevated
---

# ADR-0042: The interrupt gate consumes the calibration — and refuses decreed openings

## Status

Accepted — 2026-07-11.

## Context

The first calibration shipped with every threshold null: no severity's precision lower
bound clears its floor on the fifty-six-finding corpus. The interrupt channel therefore
must not open — but until now that was true structurally, because no interrupt path
existed. Leaving it structural makes the eventual opening a code change, reviewed under
deadline pressure at exactly the moment the project claims its biggest result. The
alternative is to build the gate now, closed, so the opening is a data change.

## Decision

The runtime consumes the calibration artifact and routes per severity. A severity's
interrupt channel is open only when its entry carries a threshold and its measured lower
confidence bound meets its floor — both conditions verified at consumption, so an
artifact edited to assert a threshold without the bound behind it is refused with the
failure named. A finding interrupts only through an open severity at or above its
threshold; everything, interrupting or not, remains in the annex, because the interrupt
is an additional push and never a relocation. Cosmetic never interrupts. A run whose
backend, model, and effort match no entry is uncalibrated and says so. A repository may
carry its own calibration, which overrides the shipped one and is named in the report.
The fixtures prove both directions: the shipped artifact opens nothing, an earned
synthetic entry opens exactly its severity, and a decreed entry is refused.

## Consequences

- The 1.0 interrupt event is now a data event: grow the corpus, re-fit, and a floor that
  clears opens its channel with no engineering between the measurement and the siren.
- The report states each severity's channel state with its numbers — open with its
  threshold, or closed with the sample size and the bound that fell short — so the
  distance to opening is always visible.
- A tampered or wishful calibration cannot open a channel: the gate re-derives the
  opening condition from the entry's own measurements at every run.
