---
status: accepted
date: 2026-07-03
severity: critical
---

# ADR-0007: Recursive ADR discovery, and coverage disclosure as a standing doctrine

## Status

Accepted — 2026-07-03.

## Context

Running R5 (the external calibration exam) against opendatahub surfaced that its real ADR log groups decisions into per-team subdirectories (`operator/`, `mlflow/`, `autox/`, `data-science-pipelines/`, `distributed-workloads/`, `model-serving/`, `automated-red-teaming/`) — a real, common convention for a large multi-team project. `loadAdrLog`'s file discovery only ever called `readdirSync` on the ADR root itself, never recursing. Every decision in every one of those subdirectories was invisible to every Tier 0 check, silently, with no signal anywhere in the report that anything had been skipped. The exam's own count (1 finding, a single top-level numbering gap) looked clean; it was clean only because most of the log was never read.

This is a second, more serious instance of a pattern this project has already named twice this session: a heuristic that's too narrow doesn't fail loudly, it fails by omission. The Pact (ADR-0001) says "the watch never stands down... every finding is surfaced." A tool that can't see most of a repo's decisions isn't standing down loudly — it's standing down silently, which the Pact forbids regardless of the mechanism that causes it.

## Decision

Two changes, recorded together because the second exists to make sure the first is never silently wrong again the same way:

**1. ADR discovery recurses under the ADR root.** `loadAdrLog` now walks the full subtree via `walkRepoFiles` (reused as-is: the same directory-exclusion list and per-file size cap already built for D4's repo-wide scan, rather than a second bespoke recursive reader with its own safeguards to get wrong). Every markdown/MDX file found, at any depth, is a candidate; `ADR_FILENAME_RE` is tested against its basename, not its full path. `ParsedAdr.fileName` changes from "always a bare basename" to "path relative to the ADR root" — for every ADR that was ever at the root (which is every ADR in every fixture and every repo this tool saw before today), that's the same string as before; only newly-visible nested ADRs get a path-qualified name (`team-a/0001-example.md`), which also happens to make `D7`'s index cross-referencing correct for an index that legitimately links into subdirectories. The root-level `README.md` remains the only recognized index — a nested README documents its own subdirectory, not the log as a whole, and is not assumed to be a second table of contents.

**2. Any markdown file under the ADR root that isn't recognized as an ADR or the index is always surfaced in the report, in a new "Coverage" section present on every run.** Not gated behind a flag, not conditional on anything being wrong — the section always renders, stating either that everything was recognized or listing exactly what wasn't. This is deliberately not modeled as a Tier 0 finding (no check ID, never counted toward `failingCount`): it isn't a claim about drift, it's a disclosure about what the tool did and didn't understand. A file landing in this list is not evidence of a problem — it might be perfectly ordinary non-ADR documentation — but the tool doesn't get to make that judgment silently. Point 1 fixes the specific recursion gap found this session; point 2 exists so the *next* gap like it — a naming convention this tool's heuristics don't recognize, wherever it turns out to live — gets a human's eyes on it instead of vanishing the same way.

## Consequences

- Re-running opendatahub after this fix is expected to surface real decisions previously invisible entirely. That re-run supersedes the opendatahub section of the R5 triage document; the earlier rows are marked stale, not deleted.
- `ParsedAdr.fileName` is no longer guaranteed to be a bare basename. Every existing fixture and check was audited against this change (root-level files are unaffected byte-for-byte); any future check that assumes `fileName` has no path separator should not.
- The Coverage section adds a small, constant amount of output to every report, clean or not. That's the deliberate trade-off this ADR makes: a permanently-visible line costs less than a silently-missed decision, every time.
- This doctrine generalizes beyond ADR discovery: "silence is a violation regardless of cause" is now precedent for any future coverage gap this tool might have, not just this one.
