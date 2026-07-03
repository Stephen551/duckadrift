# Changelog

All notable changes to duckadrift are documented here.

## [0.1.0] — 2026-07-02

First public release. Tier 0: seven deterministic checks that verify an ADR log against the codebase it describes — schema/structure lint, status-graph integrity, reference integrity, ghost references, the governed-path gate, a staleness clock, and log/index drift. Zero network calls. Zero config to get useful output against a conventional `docs/adr` or `doc/adr` log.

### Added

- `duckadrift check` and `duckadrift report` — the CLI, usable standalone or wrapped by the Action.
- The GitHub Action: PR-mode annotations and job summary, schedule-mode decay-sweep issue tracking, `workflow_dispatch` for on-demand runs.
- `--adr-dir` for repos that keep their ADR log somewhere other than `docs/adr` or `doc/adr`.
- `.duckadrift.yml`'s `dialect:` field — declare your ADR template to turn structural-completeness checks from advisory into CI-failing.

### Known limits

- Dialect auto-detection is a guess. Structural claims that rest on it (D1's missing-section check) stay advisory — informational, never CI-failing — unless you declare your dialect in `.duckadrift.yml`.
- Semantic checks (contradiction detection, drift against a decision's substance, unrecorded-decision detection) aren't built yet. That's Tier 1, coming in a later release.
