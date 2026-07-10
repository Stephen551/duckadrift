# ADR 0043 — Eye-body placement normalization proves the Phase 3 route (rendered rhythm sd 69→26); parked on bridge-vs-weld protection

**Status:** Accepted (route proven, prototype reverted, diagnostics kept)
**Date:** 2026-07-01
**Refines:** ADR 0042 / the connection-point spec
**Builds on:** ADR 0040 (the discrimination problem this re-locates), ADR 0041 (the dense-body probe used as the metric)

## Context

ADR 0042 banked thin-hand joins at ~B and deferred the Phase 3 placement rework. This
session route-found that milestone empirically: diagnose the defect from the probe
data, prototype the smallest placement change that attacks it, and measure each
layer's reaction against the same baseline.

## Decision

The Phase 3 route is PROVEN and CONCRETIZED: gated eye-body placement + kern deference
delivers rendered dense-body rhythm sd 26 on the field-failure hand (vs 69 shipped),
with the clean faces byte-stable by the gate. It is PARKED at one remaining problem: a
placement-aware protection layer that tells a deliberate thin bridge from a body weld.
The floors/weld pass cannot (their scanline min is the bridge, by design), and
removing them lets real arm-into-stem welds through. That discrimination is ADR
0040's assembled-glyph problem in its minimal, tractable form — the geometry is now
known at placement time. The prototype was fully reverted; the entry-reach
diagnostics are KEPT so the gate calibration stays visible on every run.

## Consequences

Thin-hand joins stay banked at ~B (unchanged from ADR 0042). The connection-point
spec is revised: the proven mechanism is eye-body-edge placement, which does NOT need
the Phase 1 terminal-height normalization. The milestone's crux is now precisely
scoped: build and validate the bridge-vs-weld protection layer, then re-run this
configuration. Numbers to beat are recorded here.
