# transport-proof (ADR-0044)

Hand-seeded proof fixture for the transport contract, not an S-check repo
fixture: no manifest, not part of the S-check corpus contract (same class
as `harness-proof/` and `pipeline-proof/`).

- `request.json`: the stub request whose canonical hash keys the recording.
- `claude-code.recording.json`: the first claude-code-backend recording.
  Its `response` is the PR B spike's canonical capture envelope, verbatim
  (`spike/m5-headless/captures/capture-a.stdout.json`): a real headless
  result pinned to claude-sonnet-5, replayed in CI with zero credentials.
- `bad-backend.json`: the same recording with a decreed third backend,
  proving loadRecording refuses anything outside the contract's closed set.
