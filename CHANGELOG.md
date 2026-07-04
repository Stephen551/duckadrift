# Changelog

All notable changes to duckadrift are documented here.

## [0.1.2] — 2026-07-04

This release completes two of the fork-safety hardening fixes from v0.1.1 that
turned out to be narrower than intended. No configuration changes are needed.

### Safe on untrusted pull requests (completing v0.1.1)

- Link containment now covers symlinks. v0.1.1 stopped a crafted link from
  climbing above the repository with `../`, but a link pointing through an
  in-repo symlink whose target sits outside the repository could still resolve
  to a file that isn't in your checkout. Such a link is now correctly treated as
  unresolved. This completes the v0.1.1 note that a crafted link can no longer
  reach files outside the repository — as of this release, that holds for the
  symlink case too. A legitimate symlink that stays inside the repository still
  resolves normally.
- Two more report values are shown as inert code. v0.1.1 stopped crafted link
  targets from injecting live content into the job summary and the tracking
  issue; this release extends the same protection to two values it missed — a
  directory name and an expired review-by date — so a backtick in either can no
  longer break out and inject live markup.

## [0.1.1] — 2026-07-04

This release removes false alarms on ordinary ADR logs and hardens duckadrift to run safely on pull requests from forks. No configuration changes are needed.

### Fewer false alarms

- A capitalized status like `Accepted` (the most common way to write one) is no longer flagged as invalid. Status values are now recognized regardless of case.
- Links to files with spaces in their names (written with `%20`, the normal way) now resolve correctly instead of being reported as broken.
- Links to files with parentheses in their names, like `client(v2).ts`, are no longer cut short and reported as broken.
- A changelog or history note that mentions an old, superseded ADR no longer fails your build. A mention is not proof the code still relies on that decision, so it is now surfaced as a soft note instead.
- Repos where each team keeps its own ADR numbering in its own folder are now handled correctly. An ADR that supersedes its own team's earlier decision is no longer accused of superseding an unrelated, same-numbered ADR in another team's folder. A number that only matches an ADR elsewhere, or matches nothing, is surfaced as a soft note rather than a wrong accusation.

### Broken input is surfaced, never silently passed

- An ADR with broken or unreadable front matter (the `---` block at the top) used to crash the run or, worse, slip through as clean. It is now reported as a finding. An ADR that legitimately records its status in a section instead of front matter is still accepted.
- If duckadrift ever fails to finish scanning, the check now fails loudly instead of quietly passing green on an incomplete scan.

### Safe on untrusted pull requests

duckadrift was originally built to run on your own repository. As of v0.1.1 it is hardened to run safely on pull requests from forks, where the content is not yours.

- A crafted file name can no longer pin a CPU and hang the job.
- A broken symlink or a symlink loop in the ADR folder no longer crashes the run; symlinks are skipped.
- A crafted link can no longer reach files outside the repository.
- Crafted text in an ADR can no longer inject live links or HTML into the job summary or the tracking issue; all such values are shown as inert code.
- A `governs:` value written as a single line instead of a list no longer crashes the run.

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
- Reports are now byte-identical across machines even when a repo has two files with the same name in different directories. A site-relative link's resolved evidence path used to depend on your filesystem's own directory-listing order — the same repo could report a different "found at" path on your machine than on someone else's. It's now always the same file, every time.

### Known limits

- Dialect auto-detection is a guess. Structural claims that rest on it (D1's missing-section check) stay advisory — informational, never CI-failing — unless you declare your dialect in `.duckadrift.yml`.
- Semantic checks (contradiction detection, drift against a decision's substance, unrecorded-decision detection) aren't built yet. That's Tier 1, coming in a later release.
