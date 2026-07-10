# ADR 0040 — Contextual connect-kern parked: no build-time measure separates the connector bridge from a weld; the real fix is an assembled-glyph feedback pass

**Status:** Accepted (milestone parked)
**Date:** 2026-06-30

## Context

The deferred A+ path for an extreme flashy hand is even per-pair spacing: that hand's
pairs render unevenly while the median is fine. The plan scoped it as a gated per-pair
kern refinement: measure each pair at build time, even the outliers, replace the base
connect-kern value. Step 0 (ADR 0039, the kern-drift reconciliation) and Step 1 (the
residual probe) shipped. Step 3 (the refinement) did not.

## Decision

PARK the milestone. Five build-time refinement approaches were each built and measured
against the corpus; all five fail for ONE root reason: the connector bridge. A flashy
hand's connectors intentionally overlap DEEP into the next letter, no build-time
measure can tell that intentional overlap from a body weld, and the gap the eye
actually reads does not exist until the glyphs are ASSEMBLED. The seam fix the user
actually reported shipped separately as the connector-height snap (ADR 0038). Parking
the edge case and banking the common-case win is the right call.

## Consequences

The flashy hand caps at ~B+. ADR 0039 and the Step-1 probe stay committed and useful.
The real fix, if a flashy hand ever becomes common in the field, is an assembled-glyph
feedback pass: build the font, measure the ASSEMBLED glyph geometry the way the corpus
and the eye do, compute per-pair corrections, and re-emit — because the assembled
geometry is the only thing that matches what is rendered. That is a measurement rework
inside the builder with its own risks, explicitly out of scope until the field
justifies it.
