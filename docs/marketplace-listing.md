# GitHub Marketplace listing draft (v0.1.0)

Draft copy for the Marketplace publish form. Publishing is a manual step; paste from the sections below. Notes to the publisher are marked as such and are not paste-in copy.

## Title

DuckADRift — ADR drift detection & enforcement

Note to publisher: Marketplace search is where "ADR" as a standalone token earns its place; keep it. The wordmark capitalization (DuckADRift) is correct here and in the README H1 only. Every machine surface stays lowercase `duckadrift`.

## Short description

Verifies your ADR log against your codebase. Seven deterministic checks, zero network calls, fails CI only on what it can prove.

Note to publisher: Marketplace displays the `description` field from `action.yml`, already updated to match the line above (it previously said "drift, contradictions, and unrecorded decisions" — the latter two are Tier 1 and would have overclaimed for this release).

## Categories

Suggested: Code quality, Continuous integration.

## Icon

Already set in `action.yml` (`icon: anchor`, `color: blue`). Marketplace icons are restricted to the fixed Octicon set; there is no custom image. The duck lives in the name, not the icon. No action needed on the form.

## Listing body

Everything between the two horizontal rules is paste-in copy.

---

duckadrift verifies your Architecture Decision Records against the codebase they describe, and fails your build when a recorded decision and reality disagree. It is an enforcement tool, not an authoring tool: it never writes an ADR. It reads the ones you have and treats them as testable claims.

Its design constitution, quoted from the project's own ADR-0001:

> The watch never stands down, and the siren is never wrong: every finding is surfaced, but only calibrated confidence crossed with declared consequence may open an interrupting channel.

At v0.1.0 that means: the tool runs on every PR and on a schedule, and opens contact when it finds decay. Only deterministic checks can fail CI; a guess never blocks a merge. Every finding is surfaced somewhere, even when it cannot block anything.

## Install

```yaml
- uses: Stephen551/duckadrift@v0.1.0
```

That is the whole install for a conventional `docs/adr` or `doc/adr` log. No configuration, no tokens to create. The checks make zero network calls and involve no LLMs. Optional inputs cover the rest: `adr-dir` for logs kept elsewhere, `working-directory`, and `github-token` for schedule-mode issue management.

## What it checks

Seven deterministic checks, every finding mechanically derivable from the repo:

- **D1, schema/structure lint**: malformed status, duplicate or skipped ADR numbers, missing required sections for the detected dialect (Nygard, MADR, or a looser bold-status-line style).
- **D2, status-graph integrity**: supersession targets that do not exist, supersession cycles, mutual supersession between two Accepted ADRs, an earlier Accepted ADR superseding a later one that was never updated.
- **D3, reference integrity**: links from an ADR to another ADR or to a code file that do not resolve at HEAD.
- **D4, ghost references**: code, comments, or docs citing an ADR that has since been Superseded or Rejected.
- **D5, governed-path gate**: a PR touches a path an Accepted ADR declares it governs (a `governs:` glob in frontmatter) without touching the ADR or carrying an `ADR-ACK: NNNN` marker. This is the check that makes "installed in CI" mean something.
- **D6, staleness clock**: an Accepted ADR whose `review-by:` date has passed.
- **D7, log/index drift**: the ADR directory's index or TOC disagrees with what is actually in the directory.

## Fact vs advisory

Every finding is normally asserted as fact and can fail your build, with one deliberate exception. D1's missing-required-section claim rests on an auto-detected dialect, which is a guess, so it is downgraded to advisory: visible in the report and as a PR notice, never build-failing. Declare `dialect: nygard` or `dialect: madr` in `.duckadrift.yml` and it becomes a real gate. The tool does not assert as fact what it is only guessing at.

## Modes

- **`pull_request`**: inline annotations (errors for failing findings, notices for advisory ones) plus a job summary. Failing findings fail the check.
- **`schedule`**: a full-log sweep for drift that only shows up over time. Opens or updates a single tracking issue titled "duckadrift: decay sweep" and auto-closes it once a sweep comes back clean.
- **`workflow_dispatch`**: an on-demand run.

A standalone CLI ships with the repo: `duckadrift check <path>` (exits non-zero on failing findings) and `duckadrift report <path>` (writes `duckadrift-report.md` and `duckadrift-report.json`).

## Verified before release

During pre-launch verification against real, unmodified external codebases, duckadrift produced 13 findings. All 13 were verdicted by hand before this release: 12 were false positives, root-caused to three narrow bugs, each fixed with a permanent regression fixture proven to fail before the fix and pass after it. The one remaining finding was real, confirmed by manual verification. False positives are treated as release-blocking defects; that is what "the siren is never wrong" costs.

## Limits at v0.1.0

Dialect detection is a guess unless declared, with the advisory downgrade above as the only consequence. D5 and D6 need `governs:` and `review-by:` frontmatter to have anything to enforce. Semantic checks (contradiction detection, drift against a decision's substance, unrecorded-decision detection) are Tier 1 and not in this release; the Solo and Team setup presets that configure the Tier 1 backend activate when Tier 1 ships, and there is nothing to set up today.

Full details in the [README](https://github.com/Stephen551/duckadrift#readme) and [CHANGELOG](https://github.com/Stephen551/duckadrift/blob/main/CHANGELOG.md).

---

## Pre-publish checklist (not paste-in copy)

- [x] Update `action.yml` `description` per the note under Short description.
- [x] `package.json` declared MIT with no LICENSE file to back it — added.
- [ ] Tag `v0.1.0` and confirm the `uses: Stephen551/duckadrift@v0.1.0` ref resolves.
- [ ] Push `duckadrift` to a public GitHub remote — doesn't exist yet, and is its own explicit decision, not bundled into this checklist by default.
