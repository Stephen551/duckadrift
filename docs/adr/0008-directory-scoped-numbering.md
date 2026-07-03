---
status: accepted
date: 2026-07-03
severity: elevated
---

# ADR-0008: The numbering namespace is the directory, not the whole ADR root

## Status

Accepted — 2026-07-03.

## Context

R5's opendatahub, re-examined after ADR-0007's recursion fix, showed real per-team
subdirectories (`operator/`, `mlflow/`, `eval-hub/`, and others) each numbering their
own ADRs independently, starting from 0001, with a distinguishing letter-prefix
(`ODH-ADR-ML-`, `-MS-`, `-EH-`, `-Operator-`, and so on). D1's duplicate-number check
treated every number as one global namespace across the whole ADR root, so recursion
turned a single quiet finding into nine "claimed by N files" findings, most of them
spanning a different prefix each — not authoring mistakes, a real convention the check
had no way to recognize.

Every one of those findings was still factually accurate: the bare digits genuinely do
collide. The question this session flagged as doctrine Q4 was never whether the claim
is true, but whether stating it as fact is the right confidence level when a legitimate,
common convention explains the collision just as well as an error would.

## Decision

The numbering namespace is the directory a file lives in, not the whole ADR root,
unless the repo declares otherwise:

1. **Same-directory collisions stay fact-tier.** Two files in the same directory
   claiming the same number is a provable duplicate no convention explains away —
   unchanged from the original behavior.
2. **Cross-directory collisions are advisory by default.** The same number recurring
   in a sibling directory may be an intentional per-team convention the tool can't
   disprove, so it can't assert it as fact. Surfaced, never failing, per the same
   fact/advisory mechanism ADR-0005 already built for dialect-dependent claims.
3. **A new config key, `numbering: global | per-directory`, declares which model
   applies.** Default is `per-directory` (points 1–2 above). A repo that declares
   `numbering: global` restores the original whole-root uniqueness requirement — every
   collision, same-directory or cross, reported as fact, exactly as before this ADR.
4. **A file's number and its directory are evaluated independently of every other
   check.** Skip-numbering (doctrine Q1, still open) and the annex-style same-number
   multi-file convention (doctrine Q2, still open) are untouched by this ADR — this
   decision is scoped to duplicate-number detection alone.

## Consequences

- `d1-nested-log`'s fixture answer key changes: its root/`team-a` cross-directory pair
  is now advisory, not fact — pre-approved as part of this ruling, ADR-0002's
  categorized-diff trail applies as usual but needed no separate sign-off.
- `d1-schema-lint`'s existing same-directory fixture required a wording-only oracle
  update (the claim now always names the directory, for consistency between the
  same-directory and cross-directory cases, not because the same-directory semantics
  changed) — this one was not pre-approved and got the normal categorized-diff
  treatment.
- A new fixture, `d1-numbering-global-override`, proves the config escape hatch
  actually restores fact-tier for a cross-directory collision, not merely that it's
  silently ignored.
- R5's opendatahub triage rows for the nine cross-namespace findings (doctrine Q4)
  resolve to `TRUE — advisory per ADR-0008`, superseding the open question they were
  recorded against.
- One of opendatahub's nine findings (number 0007: root plus two files both in
  `operator/`) is a same-directory collision *within* a cross-directory spread — both
  facts fire independently, side by side. Two others (0009, 0011) turn out to be pure
  same-directory collisions with no cross-directory component at all, once the split
  is applied — they were only ever counted among the nine because they shared the
  volume with the real cross-namespace cases, not because this ADR's cross-directory
  ruling actually applies to them. All three still need their own look; this ADR
  doesn't resolve whether same-directory duplicates within one team's own sequence
  are themselves mistakes.
