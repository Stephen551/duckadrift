---
status: accepted
date: 2026-07-02
severity: critical
---

# ADR-0001: The governing principle (the Pact)

## Status

Accepted — 2026-07-02

## Context

duckadrift needs one sentence every build decision can be tested against, so that "does this violate the Pact" is answerable without re-litigating the product from scratch each time. The sentence was assembled from three clauses the human lead supplied and ratified in sequence during the pre-build interrogation (see the private build brief §1.2):

1. "The tool can't go dormant, it needs to be active."
2. "The active tool can't be wrong."
3. Confidence-tiered channels with consequence escalation — a war-doctrine argument, corrected during interrogation (see PDR §1.6): the lead's own proposals for flat confidence gates ("flag everything above 40%", "40% watches, 55% flags") were rejected as mechanisms while their underlying shape — escalate by consequence, not just confidence — was kept.

The fused draft carried "pending R1" status until ratification. Ratified 2026-07-02: adopted verbatim, no rewording.

## Decision

> The watch never stands down, and the siren is never wrong: every finding is surfaced, but only calibrated confidence crossed with declared consequence may open an interrupting channel.

This is the Pact. If a build decision violates this sentence, the decision is wrong even if it works (repo law, CLAUDE.md §1).

## Consequences

What this sentence rules out — the test of a real principle (PDR §1.2):

- Rules out a run-on-demand CLI as the product. The watch never stands down → the tool runs on every PR and on schedule, and initiates contact (opens issues) when decay is found in dormant code.
- Rules out blocking merges on probabilistic findings. The siren is never wrong → only deterministic, provable checks (Tier 0) may fail CI.
- Rules out suppressing low-confidence findings. Every finding is surfaced → below-threshold findings go to a pull-based annex, never to `/dev/null`.
- Rules out confidence thresholds as constants in code. Calibrated confidence → thresholds are measured artifacts produced by the calibration harness (PDR §2.6), recalibrated per model version. A number typed by a human into a config default is a provisional lie to be replaced by evidence.
- Rules out one-size severity. Declared consequence → a 40%-confidence finding against a security-governing ADR and a 40%-confidence finding against a naming-convention ADR must not travel the same channel.

Practical effects on the build:

- Tier 0 checks (D1–D7) are the only checks permitted to fail CI, and only because they are provably false-positive-free by construction (§2.3).
- Tier 1 checks (S1–S5) are annex-only until a calibration entry exists for the exact `{backend, model, effort}` tuple in use (§2.6); an uncalibrated run is loudly labeled `UNCALIBRATED`, never silently conservative.
- Channel assignment inverts the naive design: `critical`-severity ADRs *lower* the confidence bar to interrupt, because the cost of a miss buys tolerance for a false alarm — declared per-decision in frontmatter, not assumed globally (§2.5).
- Silence is itself a violation: quota exhaustion, skipped coverage, and fork-PR credential gaps must be reported loudly, never absorbed quietly (§2.8).
