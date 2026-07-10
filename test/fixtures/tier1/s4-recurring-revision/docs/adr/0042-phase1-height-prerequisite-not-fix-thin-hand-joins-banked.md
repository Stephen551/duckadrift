# ADR 0042 — Phase 1 connection-height normalization is a prerequisite, not the fix; thin-hand joins banked at ~B pending the placement rework

**Status:** Accepted (thin-hand joins banked at ~B)
**Date:** 2026-07-01
**Refines:** ADR 0041 / the connection-point spec
**Builds on:** ADR 0038 (the connector-height snap this extends)

## Context

The connection-point spec (ADR 0041) scoped Phase 1 — normalize every glyph's entry
and exit terminal to one join height — as the lowest-risk first step and likely the
biggest single win for the thin-hand field failure. Phase 1 was prototyped and
measured before committing to it.

## Decision

Phase 1 height is a PREREQUISITE, not the fix. The variance gate works as a
discriminator, but firing it changes nothing the eye reads: the hand's connectors
ALREADY meet, and what the eye reads as "a and d don't touch" is the dense-body
daylight — the bodies sit a connector-width apart and a thin stroke bridges them. The
defect is per-pair BODY SPACING; the only lever that moves it is the placement itself
(Phase 3, structural overlap). Phase 3 is a major, risky rework, so BANK thin-hand
join evenness at ~B and defer it to a focused milestone.

## Alternatives rejected

Ship Phase 1 alone — a no-op on the render with a 3-face blast radius. Tighten the
connect gap uniformly — does not even the per-pair variance and risks welding. The
dense-body connect-kern (ADR 0041) — parked; kerning connecting pairs is the wrong lever.

## Consequences

Thin/inconsistent hands stay ~B on join evenness. The variance gate and its
calibration are recorded as the Phase 3 prerequisite, not shipped; the spec is
revised: Phase 1 = prerequisite, Phase 3 = the fix, ship them together.
