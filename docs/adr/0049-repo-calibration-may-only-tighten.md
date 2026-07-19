---
status: accepted
date: 2026-07-19
severity: critical
---

# ADR-0049: A repo-local calibration may only tighten; opening a channel requires the verifier-reviewed artifact

## Status

Accepted, 2026-07-19. Ruled on the open PR per the retired-flip lifecycle. Partially supersedes ADR-0042 and PDR 2.6.6's "a repo-local calibration.json overrides the shipped artifact"; ADR-0042 stays in the log as the scar of the reversed clause.

## Context

ADR-0042 (PDR 2.6.6) let a `calibration.json` at the scanned repo's root OVERRIDE the shipped artifact, replacing it entirely for the run. ADR-0046 then fixed that the scanned repo is untrusted input. The calibration reader trusted a repo-local file in two ways, and Stage 0's red corpus reproduced both.

It trusted the file's SHAPE. `readCalibrationEntries` validated only the top-level `schemaVersion` and that `entries` is an array; every field below was read on faith. A repo-local entry that omitted a severity crashed the reader with a `TypeError` (attack 6), and a `threshold` typed as the string `"0"` coerced through the numeric comparisons and opened a channel (attack 5's coercion vector).

It trusted the file's SOURCE. Because the repo-local file replaced the shipped one, a repo could ship its own well-formed entry with a fabricated curve that clears a floor and OPEN an interrupt channel the shipped artifact leaves closed (attack 5's core). Opening an interrupt channel is the 1.0 event (ADR-0012); it rests on the labeling review and the corpusHash chain (ADR-0038, ADR-0042) that the verifier reviews and a repo cannot self-certify. A repo opening its own channel is a fact-tier claim of a review that never happened.

## Decision

1. **Strict validation at read.** Every entry field's TYPE and RANGE is validated, not just the top-level schema: the key strings, `corpusHash`, `sampleSize`, and for each of the three severities the `floor`, `threshold`, `sampleSize`, `pointPrecision`, `lowerBound`, and every curve point's `confidence`, `n`, `truePositives`, `precision`, and `wilsonLower`, each numeric-and-in-range (or null where the schema allows null), the three severities present. Anything malformed makes the whole file uncalibrated, LOUDLY (the named unreadable state), never a thrown error and never a coerced string. This closes attack 6 (missing severity) and attack 5's string-coercion vector.

2. **A repo-local override may only tighten, never open.** The shipped (verifier-reviewed) artifact is the authority for OPENING. A repo-local `calibration.json` stops being a replacement and becomes a CONSTRAINT on top of the shipped baseline: for each severity the effective channel starts as the shipped channel, and the override may only make it more conservative, closing an open channel or raising its threshold. An override that would open a channel the shipped artifact leaves closed, or lower a threshold below the shipped value, is refused loudly and the shipped value stands. This closes attack 5's core: a well-formed, self-consistent fabricated curve still opens nothing the shipped artifact does not.

## Consequences

- With today's shipped artifact (every channel closed), a repo-local override can open nothing. That is the point: a repo may make itself more cautious, never less.
- The consumption's source vocabulary changes: a run is answered by the `shipped` baseline, or by a `repo-local-override` that tightened it. A refused override (an attempt to open or lower) is reported loudly beside the channel it targeted, never silently dropped.
- Opening a channel is now strictly a property of the shipped artifact. The interrupt-gate tests that proved opening and decree-refusal through a repo-local file now inject the earned or forged entry as the shipped baseline, because that is where opening lives; the decree-refusal in `deriveChannelState` is unchanged and still governs any entry, shipped or override.
- Stage 0's red corpus is empty after this stage: attacks 1 and 2 (ADR-0047), 3 and 4 (ADR-0048), and 5 and 6 here are all promoted to passing guards. `test/security-hardening.redtest.ts` and its config are deleted. The milestone's remaining low riders (documented separately) are not in the corpus and ride a later stage.
