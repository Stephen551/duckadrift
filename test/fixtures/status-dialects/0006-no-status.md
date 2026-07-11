---
id: adr-0006
title: "ADR-0006: No status declared anywhere"
---

## Decision

A decision recorded with no status section and no status frontmatter key — the
backstage dialect. It declares nothing, so the recognizer declares nothing:
`{ value: null, source: "none" }`, and it is honestly not accepted.

## Discussion

Statuslessness is a real shape in the wild; treating it as accepted would be an
invention, and treating it as an error would be a false finding.
