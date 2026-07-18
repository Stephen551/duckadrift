# M5.0 headless spike (throwaway)

Evidence, not code. `spike.mjs` is a throwaway collector that measured
Claude Code headless (`claude -p`) behavior for the M5 transport contract;
nothing imports it and it is not part of the build. The `captures/`
directory holds the raw artifacts the PR B ledger cites:

- `capture-a` / `capture-b`: the canonical hermetic invocation, twice,
  same prompt, pinned `--model claude-sonnet-5 --effort high`, for schema
  stability and model-echo proof.
- `default-env-capture-a` / `default-env-capture-b`: the first run WITHOUT
  `--strict-mcp-config`, kept as the hazard evidence: user-scope MCP
  config loads even in an empty directory, and the Windows shell-spawn
  quoting hazard swallowed the prompt (their `result` is the model's
  empty-prompt reply, not `pong`).
- `auth-failure`: real 401 sample (isolated empty config dir plus a bogus
  `CLAUDE_CODE_OAUTH_TOKEN`).
- `transport-failure`: total transport denial via a process-scoped
  severing proxy; the CLI retried for the full 120s window and never
  surfaced a terminal error, so the spike's own deadline killed it.
  `transport-failure.proxy-events.json` is the connection log.
- `quota-documented.md`: quota exhaustion, documented-not-observed.

Numbers, invocation shape, and the six ledger answers live in PR B's body.
Model pinning is `claude-sonnet-5` per the director's ruling; fable is
build-time only and never appears here.
