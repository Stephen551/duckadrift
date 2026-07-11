---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0036: Decay is a dead premise, not a cited one

## Status

Accepted — 2026-07-10.

## Context

S5 was built to surface the external premises an Accepted decision record treats as live,
on the theory that a human would verify them. Its own negative control refuted the theory:
the check fired on a healthy record that pins a spell-check dictionary to a locale for the
same reason it fired on a record depending on a deleted module and an uninstalled package —
every one names a premise it treats as present. A check that cannot separate a live premise
from a dead one does not detect decay; it lists premises, and it would bury real decay under
every healthy record that cites a dependency. Its pass on the positive fixture was therefore
a false green, caught by the clean baseline doing its job.

## Decision

S5 detects a premise that is dead, not one that is merely cited. It runs in two stages that
honor the tier boundary. The model, semantically, reads each Accepted record and extracts
the concrete externals it treats as live premises — a named dependency or a file or module
path — quoting each verbatim; it does not judge deadness. Deterministic code then confirms
deadness: a named dependency absent from every package manifest in the repository, or a
path that does not resolve within the repository, is dead; a present referent, or a premise
naming no concrete dependency or path, is not. Only a concretely named, provably absent
referent is called decay. A dead URL requires a network probe with its own failure modes
and is deliberately out of scope in this revision, named as a future rather than guessed.

The confirmation is conservative by construction: it produces false negatives — a decayed
premise phrased so it names no parseable referent is not reported — and no false positives.
For an annex-only, uncalibrated check, a missed decay is tolerable and a healthy premise
called decay is not; the negative control that surfaced this defect is exactly the case the
new design must keep clean.

## Consequences

- S5 is a decay sweep again: its positive fixture passes because two named referents are
  provably absent, and its negative control passes because a healthy premise names nothing
  a filesystem can falsify — the discriminator, not a sterilized fixture, keeps the control
  clean.
- The semantic and deterministic stages are testable apart: the confirmation is proven by
  direct unit tests with no model, and the extraction is proven by the recorded fixture.
- The change is contained to S5. The shared output schema and system doctrine are untouched,
  so no other check's recording is re-keyed — decay detection was S5's error to fix and
  no other check pays for it.
- A premise dropped as still-live is reported in the annex, never silently discarded; the
  Pact's silence clause governs the confirmation step as it governs every other.
