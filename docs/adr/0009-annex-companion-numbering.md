---
status: accepted
date: 2026-07-03
severity: elevated
---

# ADR-0009: Annex-companion same-directory duplicates go advisory

## Status

Accepted — 2026-07-03.

## Context

Doctrine Q2 (R5's triage doc): cosmos-sdk's ADR-050 is one decision told across three
files in the same directory — `adr-050-sign-mode-textual.md` (the main document),
`adr-050-sign-mode-textual-annex1.md`, and `adr-050-sign-mode-textual-annex2.md`. D1's
duplicate-number check fired because all three claim number 50. ADR-0008 already
established that a same-directory collision stays fact-tier by default — this is the
one recognized exception to that: a shared base filename plus a well-known annex or
companion suffix is a real, common convention for splitting one decision across
multiple documents, not an authoring accident.

## Decision

A same-directory duplicate-number collision is advisory, not fact, when every file in
the collision either is the group's shortest slug (the "main" document) or extends it
with a recognized annex/companion-style suffix — `annex`, `appendix`, `companion`,
`addendum`, `supplement`, or `part`, optionally followed by a number or short
qualifier (`annex1`, `appendix-a`). The vocabulary is deliberately narrow: a suffix
outside this list doesn't downgrade the finding, since recognizing an arbitrary
pattern risks silently hiding a genuine duplicate-numbering mistake in some other
repo whose filenames happen to share an unrelated word. Plain collisions — unrelated
slugs, or a slug relationship outside the recognized vocabulary — stay fact-tier
exactly as ADR-0008 already established.

This applies identically whether the repo is in the default `per-directory`
numbering scope or has declared `numbering: global` (ADR-0008) — annex-shape is a
property of the filenames themselves, orthogonal to directory-scoping.

## Consequences

- cosmos-sdk's ADR-050 finding downgrades from fact to advisory.
- No existing fixture's oracle changes: the pre-existing `d1-schema-lint` fixture's
  duplicate-number pair (`0001-first-decision.md`, `0001-duplicate-number.md`) has
  unrelated slugs and correctly stays fact under the new logic, unchanged.
- A new fixture, `d1-annex-companion`, is the isolating proof for the new advisory
  path.
