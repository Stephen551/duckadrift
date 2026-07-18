# Harness proof — hand-seeded recording (M3.0)

No check exists yet, so no `--record` mode exists yet (ADR-0028): this recording was
seeded by hand to prove the replay loop before any prompt is written.

- `request.json` — the stub request. `test/tier1-harness.test.ts` reads it, replays it,
  then mutates one byte and proves the stale-recording refusal fires.
- `api.recording.json` — the hand-seeded recording for that request. Its `key.promptHash`
  and `requestDigest` are both the sha256 of the canonical (sorted-keys, no-whitespace)
  serialization of `request.json`; no live call was made, so the canonical serialization
  stands in for the wire body. Its `response` is a stub shaped like a Messages API
  response body, not a real model output.
- `bad-schema-version.json` — identical shape with `schemaVersion: 2`; proves
  `loadRecording` refuses schema versions this build does not read.

These files are the harness's own proof fixtures, not a repo fixture: there is no
`docs/adr/` here and `test/tier1-fixtures.test.ts` deliberately skips this directory.
