# Pipeline proof — the M3.2 end-to-end fixture

This directory proves the semantic-check pipeline (ADR-0031) without a single
API call. It is NOT an S-check fixture: `test/tier1-fixtures.test.ts` skips it
(like `harness-proof/`), and its check definition is test-only.

- `docs/adr/` — a small, Tier 0-clean ADR log the proof check reads.
- `proof-check.ts` — the test-only `CheckDefinition` driven through the real
  runner by `test/tier1-runner.test.ts`. It is not in the production registry;
  `TIER1_CHECKS` ships empty until M3.3.
- `recording.json` — hand-seeded ADR-0028 recording for the proof check's
  canonical request (hash computed with the built modules, not by hand). Its
  response carries three findings: one well-cited, one with a fabricated
  quote, one uncited — the runner must accept exactly one and name both
  discards. Any change to the prompt architecture invalidates this recording
  by hash and fails CI with the re-record instruction, by design.
