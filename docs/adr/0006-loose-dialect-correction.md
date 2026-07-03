---
status: accepted
date: 2026-07-02
severity: elevated
---

# ADR-0006: Correction — loose dialect still checks Context/Decision, always advisory

## Status

Accepted — 2026-07-02. Corrects ADR-0004's second decision point (loose dialect asserting zero required sections). ADR-0004's first point (Problem/Problem Statement as Context aliases) is unaffected and stands as written.

## Context

ADR-0004 gave the loose dialect zero required sections, reasoning that "a genuinely freer template shouldn't be measured against Nygard's structure at all." Run against the real repo that motivated loose-dialect detection in the first place, this meant six ADRs missing a Context-equivalent section (0023, 0031–0034, 0036) produced no finding at all — not fact, not advisory, nothing. The director caught this directly: asked whether they appeared as advisory observations per ADR-0005, and they did not. They were silently dropped.

That's a Pact violation (ADR-0001): "every finding is surfaced... below-threshold findings go to a pull-based annex, never to `/dev/null`." Zero required sections wasn't "advisory, always" — it was "never checked," which is silence, not the soft-surfacing ADR-0005 exists to guarantee. The distinction matters: ADR-0005 already built the exact mechanism this needed (always-advisory findings that never fail CI) — ADR-0004 just didn't route loose dialect through it.

## Decision

`REQUIRED_SECTIONS.loose` reverts to `["context", "decision"]` — the same requirement as nygard. The correction is not in what's required; it's in the channel: loose can never be a *declared* dialect (`src/config/load.ts` only accepts `nygard`/`madr` as declarable), so any loose-dialect finding is automatically routed to `advisory: true` by D1's existing fact/advisory gate (ADR-0005) — no separate mechanism needed, the existing one already covers it once loose actually produces findings to gate.

## Consequences

- Re-run against the real repo after this fix: not just the six named ADRs but 13 loose-dialect ADRs surface advisory findings — the corrected detection catches files the original nygard-marker heuristic never classified at all, not only the six the director happened to name. More coverage, same failing count (0 from this class).
- General lesson, not just for this ADR: "assert nothing" and "advisory, always" are different design choices with different failure modes. The former is silent; the latter is surfaced-but-non-blocking. When in doubt about a check's confidence, route through advisory — don't disable the check.
- ADR-0004 is not marked superseded; only its loose-dialect consequence is corrected here. Its Problem/Problem Statement alias mechanism is untouched and still governs.
