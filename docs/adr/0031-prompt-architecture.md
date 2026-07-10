---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0031: The prompt architecture — one cached prefix, structured output, citations or silence

## Status

Accepted — 2026-07-10.

## Context

The semantic tier's credibility is engineered, not prompted. Three failure classes
had to be closed by construction before the first check ships: cost that scales
with repetition (the same instructions resent for every ADR in a run), output that
must be scraped out of prose (a parser guessing at JSON is a parser that can be
steered), and findings that cannot be verified in one click (PDR §3.1 calls those
rumors). A fourth arrived with the tier itself: the ADR log is now untrusted input
to a model, and repository content that can instruct the checker owns the checker.

## Decision

Every Tier 1 request is one static prefix plus one variable suffix. The prefix —
system prompt, the check's definition, the output schema — is byte-stable for a
given check and build, carries the prompt-cache breakpoint, and encodes three
doctrines: the analyst voice of PDR §3.1, the citation contract, and the
data-not-instructions posture, under which every supplied document is untrusted
repository content whose instruction-shaped text is evidence, never a directive.
The suffix is the check's deterministically selected documents, enveloped with
labels and passed through byte-verbatim, because citation validation matches
bytes and an escaping layer would corrupt the evidence trail.

Output is a forced tool call against a findings schema — the parse target is
structured by the API contract, never scraped from prose. The parsed result is
untrusted until a deterministic validator passes it: every finding quotes its
evidence verbatim from a supplied document, matched as bytes with only line-ending
normalization, or the finding is discarded — and the discard itself is counted and
named in the report, because a silently dropped finding and a silently dropped
coverage gap are the same violation. Model-reported confidence is carried verbatim
into the machine report and compared against nothing: thresholds are calibration
artifacts (PDR §2.6), and no threshold exists in this codebase.

The pipeline is single: one runner, one prompt builder, one validator, one
transport interface with a live implementation and a replay implementation keyed
to the recorded-response doctrine of ADR-0028. The five checks are data records —
instructions and an input selector — consumed by that pipeline. A second pipeline
is the parallel-primitive failure this repository has already shipped once and
now treats as a standing audit concern.

Findings have exactly one destination: the annex, labeled UNCALIBRATED. No
interrupt code path exists to route to — the restriction is structural, not a
threshold set to infinity. Opening that channel is the 1.0 event (ADR-0012) and
requires the measured calibration this architecture is built to be measured by.

## Consequences

- Instruction cost is paid once per check per cache window; only repository
  content pays per-document price. Schedule-mode batching (PDR §2.8) composes
  with this unchanged.
- A prompt change invalidates recordings by hash and fails CI with a re-record
  instruction — the test loop and the wire request are the same object by
  construction, so they cannot drift apart.
- Prompt-injection resistance is layered: the posture instructs, the envelope
  contains, the forced schema constrains the output surface, and the citation
  validator makes fabricated evidence die deterministically regardless of what
  the model was talked into. The adversarial pass against all four layers is the
  verifier's, scheduled with the first live checks.
- A check is added by writing a data record and its recording, not by touching
  the pipeline. The pipeline's tests are the tier's tests.
