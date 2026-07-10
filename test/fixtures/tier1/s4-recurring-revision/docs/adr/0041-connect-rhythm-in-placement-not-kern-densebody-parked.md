# ADR 0041 — Even connect rhythm belongs in connector PLACEMENT, not a per-pair kern; the dense-body kern is parked, superseded by a connection-point spec

**Status:** Accepted (dense-body kern parked)
**Date:** 2026-07-01

## Context

A field cursive sheet (a thin, tightly-drawn hand, now a corpus fixture) rendered with
visibly uneven joins: letters that should touch left daylight while others jammed. The
shipped band-profile rhythm gate did NOT catch it, because that metric measures the
connector-inclusive closest approach. A render-scale dense-body measure reproduced the
eye's read exactly, and decomposing the built font showed the GPOS connect-kern
(ADR 0039) SCATTERS the rendered dense-body rhythm on 7 of 11 connect corpus faces.

## Decision

PARK the dense-body kern. Two implementations were built and measured; both fail, and
professional practice explains why in one line: even rhythm in a connected script
comes from consistent connector PLACEMENT, not from kerning the connecting pairs. The
real fix is a CONNECTION-POINT SPEC — one join height + angle that every glyph's entry
and exit terminal is normalized to, with structural deep-bridge overlap, so connectors
meet by construction — scoped as its own milestone in the connection-point spec of
2026-07-01. Both rejected attempts are a build-time proxy diverging from the render —
the same root as ADR 0040: no build-time measure separates the connector bridge from
a weld.

## Consequences

Thin/inconsistent hands stay at ~B on join evenness until the connection-point spec
lands. The flashy-hand park (ADR 0040) is validated: professionals deliberately do NOT
automate deep flourished overlap. The render-scale dense-body probe and the handmade
fixture are KEPT as guardrails — they catch what the band-profile gate misses.
