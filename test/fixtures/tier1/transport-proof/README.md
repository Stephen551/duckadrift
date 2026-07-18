# transport-proof (ADR-0044)

Hand-seeded proof fixture for the transport contract, not an S-check repo
fixture: no manifest, not part of the S-check corpus contract (same class
as `harness-proof/` and `pipeline-proof/`).

- `request.json`: the stub request whose canonical hash keys the recording.
- `claude-code.recording.json`: the first claude-code-backend recording.
  Its `response` is the SEAM's output shape (PR D): the extracted,
  api-canonical tool call plus the usage block measured in the PR B
  spike's canonical capture, replayed in CI with zero credentials. A
  recording stores what the seam returns, so replay and live stay one
  pipeline.
- `bad-backend.json`: the same recording with a decreed third backend,
  proving loadRecording refuses anything outside the contract's closed set.
