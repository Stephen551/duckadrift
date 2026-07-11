---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0035: The diff-and-decay checks — S2, S3, S5, and the modes they run in

## Status

Accepted — 2026-07-10.

## Context

The semantic tier's full-log checks (S1 contradiction, S4 recurring revision) shipped
first. The remaining three checks reason about different inputs: S2 and S3 about what a
pull request changed, S5 about decay a diff never surfaces. Three questions had to be
settled before building them: what S2 reads to judge a change, how S5 dispatches its
call, and what each check does when its input is absent.

## Decision

S2 reads the current content of changed governed files at HEAD, not a diff hunk. The
violation lives in the resulting state, and file content matches the citation validator's
byte-verbatim contract — a diff hunk's markers would not. No second diff representation is
built; S2 reuses the filename-level changed-file list for targeting and the working tree
for substance.

S2 and S3 are pull-request checks: their input is the diff, and without a pull-request
context each reports a named no-input skip. S3 additionally stands down when the diff
touched a decision record — its quarry is the unrecorded change, so an engaged decision
path is not its case. The whole-tree "governed files" form of S2 named in the product
specification requires a repository-wide file enumeration this build does not have; it is
a named future, not a silent gap. On a whole-tree sweep the semantic coverage is S1, S4,
and S5 — the sweep is not left empty.

S5 is a whole-log check and runs in either mode. It ships on the synchronous transport.
The Batch API the specification prescribes for schedule-mode sweeps returns a different
response envelope; recording S5 against one transport and running it against another would
reproduce the configuration-drift failure this project treats as a first-order risk. Batch
is deferred to the calibration milestone as one isolated transport change carrying its own
recording — the detection logic is transport-independent and the development loop makes no
live call, so nothing is lost by sequencing it there and much is protected.

Every mode decision is expressed in a check's own input selector, branching on the
presence of a pull-request context, exactly as the shared full-log selector already does.
No check consults the relevance gate; the gate runs once, ahead of the whole tier, and a
no-signal pull request never reaches a check.

## Consequences

- S2, S3, and S5 land on the existing pipeline, envelope, and validator with no new
  pipeline, transport, or diff representation — three same-primitive checks in one change.
- A check with no input for its mode says so as a named skip; silence is never a check's
  answer to "nothing to do here."
- The whole-tree S2 form and the Batch transport are recorded futures with a stated
  reason for their timing, not dropped requirements.
- Per-check token usage is measured and surfaced, so the cost of the tier is reported from
  observation, never estimated.
