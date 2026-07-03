# Changelog

All notable changes to duckadrift are documented here.

## [0.1.0] — 2026-07-03

First public release. Tier 0: seven deterministic checks that verify an ADR log against the codebase it describes — schema/structure lint, status-graph integrity, reference integrity, ghost references, the governed-path gate, a staleness clock, and log/index drift. Zero network calls. Zero config to get useful output against a conventional `docs/adr` or `doc/adr` log.

### Added

- `duckadrift check` and `duckadrift report` — the CLI, usable standalone or wrapped by the Action.
- The GitHub Action: PR-mode annotations and job summary, schedule-mode decay-sweep issue tracking, `workflow_dispatch` for on-demand runs.
- `--adr-dir` for repos that keep their ADR log somewhere other than `docs/adr` or `doc/adr`.
- `.duckadrift.yml`'s `dialect:` field — declare your ADR template to turn structural-completeness checks from advisory into CI-failing.
- ADR logs organized into subdirectories now work. Discovery recurses, so decisions grouped into per-team or per-area folders are found and checked like any other ADR. Before, anything below the top level was invisible.
- A "Coverage" section in every report, listing the markdown files under the ADR directory that weren't recognized as an ADR or an index. A decision file with a slightly-off name shows up there instead of being silently skipped forever.
- `.duckadrift.yml`'s `numbering:` field — `per-directory` (the default) lets each subdirectory keep its own number sequence; `global` says numbers must be unique across the whole log and fails the build when they aren't.
- `.duckadrift.yml`'s `numbering_gaps:` field — a missing number in the sequence is advisory by default, since mature logs retire numbers legitimately (a withdrawn proposal, a renumbering). Set it to `fail` if a gap should block CI.

### Fixed

Running the tool against real ADR logs from large open-source projects surfaced a set of gaps. All fixed:

- More filename styles are recognized as ADRs: letters glued straight to the number with no separator, a project prefix repeated in the filename, and similar real-world variants that a narrower pattern used to miss.
- Index checking now understands bullet and numbered lists, not just tables. A log whose index is a plain Markdown list used to look driftless no matter what it actually listed.
- Links inside HTML comments no longer count as references. A commented-out draft or old link scaffolding used to get flagged as broken even though nothing renders it.
- A decision told across several files — a main document plus companions named with `-annex1`, `-appendix`, `-addendum`, `-supplement`, or `-part` style suffixes — is no longer flagged as a numbering mistake.
- An ADR number reused in a different subdirectory no longer fails the build. Teams numbering their own decisions independently is a real convention, so it's surfaced softly instead. The same number twice in one directory still fails.
- Reference checking no longer reports things that were never file or code references: GitHub `@username` mentions and plain email addresses in author or reviewer tables, scoped package names like `@scope/name`, and links starting with a leading slash (relative to the repo root).
- Links written for how a documentation site renders pages — MkDocs- or Docusaurus-style, no file extension, often a trailing slash — now resolve as long as the real file exists somewhere in the repository. A link with no match anywhere still fails.
- Advisory findings now read like what they are. A numbering gap, a duplicate ADR number across directories or across an annex-style pair, or a missing section under an undeclared dialect used to say "required" or "skips" no matter the tier. They now read as an observation with a way to resolve it — declare a dialect, or the numbering convention, and the wording tightens up to match. Fact-tier findings (dialect declared, `numbering: global`, `numbering_gaps: fail`, or a same-directory collision with no annex explanation) keep their direct, unhedged wording.

### Known limits

- Dialect auto-detection is a guess. Structural claims that rest on it (D1's missing-section check) stay advisory — informational, never CI-failing — unless you declare your dialect in `.duckadrift.yml`.
- Semantic checks (contradiction detection, drift against a decision's substance, unrecorded-decision detection) aren't built yet. That's Tier 1, coming in a later release.
