# DuckADRift

An ADR is a written rubber duck: you explain the decision to it, and the act of explaining is the point. duckadrift is the duck that talks back. It reads your Architecture Decision Records and verifies them against the codebase they describe, on every PR and on a schedule, and it fails your build when a recorded decision and reality disagree.

It is an enforcement tool, not an authoring tool. It never writes an ADR.

One sentence governs every design decision in this tool, quoted from its own [ADR-0001](docs/adr/0001-governing-principle.md):

> The watch never stands down, and the siren is never wrong: every finding is surfaced, but only calibrated confidence crossed with declared consequence may open an interrupting channel.

At v0.1.0 that sentence has three practical consequences. The tool runs continuously and initiates contact when it finds decay; it is not a run-on-demand linter. Only deterministic checks can fail CI; a guess never blocks a merge. And every finding is surfaced somewhere, even the ones that are not allowed to block anything.

And when semantic checks arrive, they earn the right to interrupt you only by measurement: a labeled corpus establishes how often a given confidence level is actually right, and the tool interrupts only above the level that clears a declared precision floor. Confidence thresholds are measured, never typed into a config. That doctrine is why the semantic tier isn't here yet — it does not ship until it can be calibrated.

As of v0.2.0, that bar is met and the semantic tier ships calibrated. Five model-driven checks read your decision records against the code and each other, every finding quoting its evidence verbatim or being discarded aloud. Every semantic finding lands in the report's annex — the complete record, always. A finding may additionally interrupt (a PR comment, or a tracking issue on scheduled runs) only when its severity's channel is open, and a channel opens only when the published calibration proves that findings at that confidence are right often enough to clear the severity's precision floor, by Wilson lower bound rather than lucky average. The first shipped calibration — 56 hand-labeled findings from nine real repositories, curve published in `calibration.json` — opens nothing. That is the honest reading of a first corpus: the annex works today, the interrupt is earned by data, and the report shows each severity's exact distance to opening.

## When the siren was wrong

There is no screenshot here. Instead, the pre-launch verification record, because a tool whose pitch is "the siren is never wrong" should show you what happened when it was.

Before this release, duckadrift ran against real, unmodified external codebases, not curated fixtures. It produced 13 findings, and every one was verdicted by hand before shipping. Twelve were false positives, the tool crying wolf. They root-caused to three narrow bugs: a dialect-detection gap that missed a real-world ADR template variant, a link-resolution assumption that ignored repo-root-relative code citations, and an index parser that read prose links as if they were index entries. Each fix shipped with a permanent regression fixture, a test proven to fail before the fix and pass after it, so the same false positive cannot silently come back. The one remaining finding was real, confirmed correct by manual verification, and survived the whole process untouched.

That is not a highlight reel. It is what taking "the siren is never wrong" seriously looks like while the tool is being built.

## Install in 60 seconds

```yaml
- uses: Stephen551/duckadrift@v0
```

`@v0` floats to the latest v0.x release; pin `@v0.1.2` for a reproducible build.

That is the whole install for a conventional `docs/adr` or `doc/adr` log. No configuration, no tokens to create. The checks themselves make zero network calls and involve no LLMs; everything is computed from the repo at HEAD.

A complete workflow covering all three modes:

```yaml
name: duckadrift
on:
  pull_request:
  schedule:
    - cron: "0 6 * * 1" # weekly decay sweep
  workflow_dispatch:

permissions:
  contents: read
  issues: write # schedule mode opens and updates the decay-sweep issue

jobs:
  duckadrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # PR-scoped checks (D5) diff against the base branch; full history is needed to find the merge base
      - uses: Stephen551/duckadrift@v0
```

PR-mode checks diff against the base branch to see what the PR changed, so the canonical workflow fetches full history with `fetch-depth: 0`. Without it, `actions/checkout` is shallow and has no merge base with the base branch — duckadrift then runs the full-log checks and skips the D5 governed-path gate with a warning, rather than failing.

Optional inputs exist for the unconventional cases: `adr-dir` if your log lives somewhere other than `docs/adr` or `doc/adr`, `working-directory` if the repo root to check is not the workflow's root, and `github-token` if the default token is not what schedule mode should use for issue management. PR annotations need no token at all.

## Why enforcement, not authoring

The existing ADR ecosystem (adr-tools, log4brains, ADR Manager, the recent wave of tools that draft ADRs for you) builds authoring: help producing the document. Nobody builds enforcement: treating the ADR log as testable claims about the codebase and gating merges on violations. An authoring tool's output is prose a human reviews; duckadrift's output is verdicts, engineered to be trustworthy enough to fail a build on.

## The seven checks

All seven are deterministic. No probabilistic scoring, no model calls; every finding is mechanically derivable from the repo.

| ID | Check | What it catches |
|----|-------|-----------------|
| D1 | Schema/structure lint | Malformed status, duplicate or skipped ADR numbers, missing required sections for the detected dialect (Nygard, MADR, or a looser bold-status-line style) |
| D2 | Status-graph integrity | Supersession targets that do not exist, supersession cycles, two Accepted ADRs each claiming to supersede the other, an earlier Accepted ADR superseding a later one that was never updated |
| D3 | Reference integrity | Links from an ADR to another ADR or to a code file that do not resolve at HEAD, in both ADR-directory-relative and repo-root-relative styles |
| D4 | Ghost references | Code, comments, or docs outside the log citing an ADR that has since been Superseded or Rejected |
| D5 | Governed-path gate | A PR touches a path an Accepted ADR governs (a `governs:` glob in its frontmatter) without touching the ADR or carrying an `ADR-ACK: NNNN` marker in the commit message or PR body |
| D6 | Staleness clock | An Accepted ADR whose `review-by:` date has passed |
| D7 | Log/index drift | The ADR directory's index or TOC disagrees with what is actually in the directory (reads the index's table only, not incidental links in surrounding prose) |

D5 is the flagship. It is the check that makes "installed in CI" mean something: declare in an ADR which paths it governs, and nobody changes those paths again without either updating the decision or explicitly acknowledging it.

A finding, exactly as the report renders it:

```
### D5 — Governed-path gate (1)

- PR touches `src/auth/session.ts`, governed by Accepted ADR-0007, without modifying the ADR or carrying an `ADR-ACK: 0007` marker.
  - Evidence: `0007-session-tokens.md`, `src/auth/session.ts`
  - Consequence: A silent change to a governed path bypasses the decision the team recorded to guard it.
```

## Fact vs advisory

Every finding is normally asserted as fact and can fail your build. There is one exception, and it is deliberate. D1's missing-required-section claim depends on knowing which ADR template you use. Unless you have declared it, the dialect is auto-detected, which is a guess. A claim resting on a guess is downgraded to advisory: it still appears in the report, it still shows up on the PR as a notice, it just never fails the build.

Declare your dialect and it becomes a real gate:

```yaml
# .duckadrift.yml
dialect: madr # or: nygard
```

The principle behind the split: the tool does not assert as fact what it is only guessing at.

## Modes

- **`pull_request`**: annotates the PR inline with GitHub-native annotations, errors for failing findings and notices for advisory ones, plus a job summary. Failing findings fail the check.
- **`schedule`**: a full-log sweep for the drift that never shows up in any single diff, only over time. Opens or updates a single tracking issue titled "duckadrift: decay sweep" and auto-closes it once a sweep comes back clean. This is the mode that keeps the watch from going dormant.
- **`workflow_dispatch`**: an on-demand run.

## Tier 1: the semantic checks, and the Solo and Team presets

Tier 0 is string-provable fact. Tier 1 reads the log the way a reviewer would: contradictions between decisions (S1), code drifting from a decision's substance (S2), decisions made in code but never recorded (S3), the same decision circling without closure (S4), and premises that quietly died (S5). Tier 1 findings never fail CI; they land in the report's annex, and only a calibrated confidence crossed with a declared consequence may ever open an interrupting channel. The shipped calibration carries an entry per backend tuple, thresholds exactly where the labeled corpus puts them; today every threshold is null by data, so every channel is closed and says so with its numbers.

One engine, two transports. Solo and Team are setup presets, never code paths:

- **Solo**: the `claude-code` backend rides your Claude subscription through the Claude Code CLI. Needs the CLI installed and `CLAUDE_CODE_OAUTH_TOKEN` in the environment (`claude setup-token`). Disclosure, stated because it is true: the CLI dials its own telemetry endpoint (a Datadog intake) alongside the API host on every call; if that matters in your environment, use the api backend.
- **Team**: the `api` backend calls the Messages API directly with `ANTHROPIC_API_KEY`, the usual choice for CI secrets shared by a team.

```yaml
# .duckadrift.yml
tier1:
  enabled: true
  backend: claude-code # or: api
  model: claude-sonnet-5 # the calibrated default
  effort: high # the calibrated default
  deadline_seconds: 120 # the transport's hard ceiling per call
```

Model and effort key the calibration: change them and the run is loudly uncalibrated until a matching entry exists. Missing credentials never fail a run silently; the report names exactly which variable is absent and why fork PRs are expected to lack it. Sweeps are checkpointed: quota exhaustion pauses visibly with "N of M checks completed" and the next scheduled run resumes without re-spending a completed unit.

## The CLI underneath

The Action wraps a plain CLI you can run anywhere:

```
duckadrift check <path>     exits non-zero if any finding fails
duckadrift report <path>    writes duckadrift-report.md and duckadrift-report.json
```

It is not published to npm yet. From a clone: `npm ci && npm run build`, then `node dist/cli/index.js check .` (or `npm link` to put `duckadrift` on your PATH).

## Limits

Stated plainly, because a drift-detection tool that oversells itself has failed before it starts.

- **Dialect detection is a guess unless you declare it.** The consequence is exactly the advisory downgrade described above, nothing worse. A `dialect:` line in `.duckadrift.yml` removes the guess.
- **D5 and D6 need declarations to have teeth.** `governs:` globs and `review-by:` dates are opt-in frontmatter. An ADR log that declares neither gives those two checks nothing to enforce; the other five run regardless.
- **A link path with spaces must be angle-bracketed.** Reference checking parses links with a spec-compliant CommonMark parser, and CommonMark does not allow unescaped spaces in a bare link destination — `[x](my design (v2).md)` is read as a link to `my design` with a title, not a file with spaces. Write `[x](<my design (v2).md>)` and the full path resolves. A bare path with spaces is not checked (never mis-flagged, never falsely resolved).
- **ADR filenames need a title, not just a number.** Detection keys on the `NNNN-title.md` convention — the adr-tools default. A log whose records are numbered without a title slug (`ADR-7.md` rather than `0007-use-postgres.md`) is not recognized, and those files go unchecked rather than mis-checked. Broadening detection to the number-only form is on the backlog; for now the tool stays silent on it rather than guessing.
- **A link into a git submodule resolves only when the submodule is checked out.** Reference checking reads the working tree at HEAD, so a link into a submodule path resolves when the submodule is initialized and is reported unresolved otherwise — which matches the default CI checkout, where submodules are not fetched. If your workflow checks submodules out, initialize them before the check runs. Never falsely resolved.
- **Tier 1 never fails CI, by design.** A probabilistic finding blocking a merge would violate the sentence at the top of this README. Semantic findings live in the annex; the interrupt channel opens only when a calibration floor genuinely clears, and none has yet.
- **Tier 1 spends tokens.** The relevance gate keeps PR-mode calls to diffs that trip a real signal, and sweeps are checkpointed so nothing is ever paid twice, but a sweep over a large log is a real model bill on the api backend and real subscription usage on claude-code. The report carries the measured usage.

## More

- [CHANGELOG.md](CHANGELOG.md) for release history.
- [CONTRIBUTING.md](CONTRIBUTING.md) for the fixture-per-check rule and the PR checklist.
- [docs/adr/](docs/adr/) is this repo's own ADR log, kept in the format duckadrift checks. ADR-0001 records the governing principle quoted above; ADR-0002 records the policy that keeps the test oracle honest.

---

The duck stays out of the output. Findings, reports, and annotations speak in a plain analyst voice: claim, evidence, consequence. The duck introduces the tool; it never talks through it.
