---
status: accepted
date: 2026-07-02
severity: elevated
---

# ADR-0003: Tier 1 relevance gate and cost engineering

## Status

Accepted — 2026-07-02

## Context

Tier 1 is BYOK — every semantic check is a real API bill the user pays directly. That's a standing adoption risk: nobody wants a bot that spends their money on every PR whether or not there's anything worth checking. Two separate cost problems need separate answers: which PRs even deserve a model call, and how to make the calls that do happen as cheap as they can be.

## Decision

1. **Relevance gate (PR mode).** Tier 1 checks only fire when the diff touches a governed path (an Accepted ADR's `governs:` glob) or trips a deterministic architectural signal — new dependency, schema/storage change, cross-module boundary move. A no-signal PR gets zero API calls. Skipped runs are reported in the annex as "skipped: no signal" — silence is a violation whether it's about a finding or about not having looked at all.
2. **Prompt caching.** Every Tier 1 call's static instruction prefix (system prompt, check definitions, output schema) is cached. It's identical across every finding and every ADR in a run; only the variable per-ADR/per-diff content should pay full price.
3. **Batch API for schedule mode.** Full-log decay sweeps have no latency requirement — nothing is waiting on the result the way a PR reviewer is. Batch pricing (50% off) is the correct default there. PR mode stays synchronous, since it gates a human's merge.

## Consequences

- The relevance gate means Tier 1's real-world cost tracks how often a repo touches governed or architectural surfaces, not how many PRs it opens. A repo with a thin `governs:` vocabulary pays less but also gets checked less — the same tradeoff the governed-path gate already accepts, now extended to Tier 1.
- Prompt caching and batch pricing are cost levers, not correctness levers: they change what a run costs, never what it finds. Nothing here touches calibration or channel doctrine.
- Expected-cost documentation (measured tokens, never estimated) gets real numbers to report once Tier 1 ships and repos start accumulating real runs. Tier 0 alone makes zero network calls and has nothing to measure — confirmed running Tier 0 against four real external repos for Gate G1, all Tier 0, all local.
