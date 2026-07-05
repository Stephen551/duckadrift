---
status: accepted
date: 2026-07-04
severity: elevated
---

# ADR-0015: A decision section may be titled `Decision` or `Decisions`

## Status

Accepted — 2026-07-04.

## Context

The pre-publish clause-A pass — Tier 0 run at v0.1.3 against the five external R5
logs plus the internal corpus, before the Marketplace listing — surfaced a D1
false positive. In one internal ADR log, four decisions titled their decision
section `## Decisions`, the plural, and D1 reported each as "missing the required
`## Decision` section." The section was present in every case; the claim was
untrue. Across that same log forty-seven ADRs used the singular `## Decision` and
matched correctly, and only the four plural ones missed — the gap was purely
singular-versus-plural.

The finding surfaced as advisory only because the log's dialect was guessed rather
than declared, and ADR-0005 downgrades a structural claim on a guessed dialect. For
a declared dialect the same check fails CI. This was therefore a latent fact-tier
false positive: a heading a normal author would write, one plural `s` from the
canonical form, that would block a merge on any log that declared its dialect.

D1 resolves required sections through the alias mechanism ADR-0004 established —
`## Context` is satisfied by `Context`, `Problem`, or `Problem Statement`,
"extensible to future variants without touching detection logic." That table
carried an entry for the context section but none for the decision section, so
decision-section matching fell back to the exact singular.

## Decision

The decision section is satisfied by `Decision` or `Decisions`, added to ADR-0004's
`SECTION_ALIASES` table — the same machinery, one more entry, no change to detection
logic. The alias is keyed on the `decision` required section, which the Nygard and
loose dialects require.

MADR is untouched, and deliberately so: MADR requires its own `Decision Outcome`
section, not `Decision`, so the plural alias cannot leak into it — a Nygard ADR does
not pass on a MADR heading, and a MADR ADR is not measured against the Nygard alias.
An earlier framing considered folding `Decision Outcome` into this alias; that was
rejected in verifier review as incorrect for exactly this reason.

When the decision section is genuinely absent, D1 still fires, and the claim now
names both accepted headings — "missing the required `## Decision` or `## Decisions`
section" — so a reader sees what would satisfy it.

## Consequences

- The four plural-`Decisions` false positives in the clause-A corpus clear. The same
  log's one genuinely-missing-decision ADR still fires, and its unrelated
  index-drift (D7) finding still fires — the log went from six findings to two, both
  true positives, verified on the fixed build.
- One existing fixture oracle changes under `ADR-ACK: 0002`: `d1-schema-lint`'s
  missing-decision claim enriches to name both aliases. The finding, its evidence,
  and its consequence are unchanged — wording only.
- A new isolating fixture proves three things at once: a `## Decisions` heading
  satisfies the requirement, a genuinely absent decision section still fires, and a
  MADR log is unaffected by the alias.
