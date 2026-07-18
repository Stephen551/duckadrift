---
status: proposed
date: 2026-07-17
severity: elevated
---

# ADR-0043: Calibration entries satisfy gates by discipline, not by floors met

## Status

Proposed, 2026-07-17. The director flips this to Accepted on the merge ruling.

## Context

PDR Layer 4 Gate G5 and 1.0 clause 4 read "calibration entry meeting every severity floor." The `api` entry, shipped at v0.2.0 and G4-signed, meets no floor: every threshold is null by data, the honest state ADR-0038 defined. The literal wording therefore contradicts ratified practice and would silently convert M5 and 1.0 into corpus-scale milestones nobody ratified.

This is documentation drift against a ratified decision, the defect class this tool exists to catch, found in its founding document.

## Decision

A gate or 1.0 clause requiring a backend's "calibration entry" is satisfied by an entry produced through the M4 harness under ADR-0038 discipline: real labeled corpus, Wilson lower bounds, its own corpusHash, thresholds exactly where the data puts them, null included. Floors govern when a channel OPENS, never whether an entry EXISTS.

The PDR wording is recorded as errata by this ADR; the PDR text itself is not rewritten. The scar stays in history.

## Consequences

- G5 and 1.0 clause 4 are closeable by discipline.
- Channel opening remains purely a data event per ADR-0042.
