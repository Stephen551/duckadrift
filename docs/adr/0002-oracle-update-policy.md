---
status: accepted
date: 2026-07-02
severity: critical
governs:
  - "test/fixtures/**/expected-findings.json"
---

# ADR-0002: Oracle-update policy

## Status

Accepted — 2026-07-02

## Context

M0 built the Tier 0 fixture corpus before any detector existed (PDR §4, M0): each fixture's `expected-findings.json` was hand-authored ground truth describing which check should fire and why. That text was necessarily a guess at wording no detector yet produced.

M1 implemented the real D1–D7 detectors and ran them against their own fixtures. The exact output — claim wording, evidence shape, and in D2's case three entirely new findings once the fixture grew to cover sub-clauses M0 never isolated — differed from the M0 guesses. Every difference was reviewed and judged correct (see the session's diff, presented for director triage), and `expected-findings.json` was updated to match real detector output, all bundled into commits alongside the fixture and engine work that produced them.

That bundling is the problem this ADR exists to close. `expected-findings.json` is not a scratch file — it is the oracle kill clause A (PDR §1.5) measures "zero false positives" against. If the oracle can be edited in the same breath as the code that's supposed to satisfy it, a bug can be silently "fixed" by loosening the expectation instead of correcting the detector, and nothing in the diff distinguishes the two cases from each other.

## Decision

Any change to a file matching `test/fixtures/**/expected-findings.json`:

1. **Ships in a dedicated commit, never bundled with `src/` engine changes.** A commit that touches both a check's implementation and its own fixture's ground truth in the same diff hides which one moved to satisfy the other.
2. **Requires the director's explicit sign-off before merge.** This path is `governs:`-declared above; once the Action wrapper (M2) is live, D5 enforces this automatically via `ADR-ACK: 0002`. Until then, sign-off is manual.
3. **Ships with a categorized diff in the commit message or PR description**: findings added, findings removed, findings detail-enriched (wording/evidence precision with no change in what fired). Every added or removed finding carries individual justification. Detail-only changes do not require per-line justification but the full diff must still be presented.

## Consequences

- Slower iteration on fixture wording after a check's first implementation — every refinement is its own reviewed commit. Accepted: the oracle is a trust asset, not a scratch file.
- The M1 sync (this session, predating this ADR) bundled fixture-oracle changes for D1/D2/D3/D7 into commits alongside engine and fixture-expansion work, and shipped without prior sign-off. It is documented here as the incident that produced this policy, triaged retroactively rather than pre-approved, and is not a precedent — the policy governs everything after this ADR.
- Future check families (Tier 1 semantic checks, M3+) inherit this discipline once their own fixture corpora and `expected-findings.json`-equivalents exist.
