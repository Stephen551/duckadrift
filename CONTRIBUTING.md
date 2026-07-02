# Contributing to duckadrift

## Before opening a PR

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] If the PR changes anything under `src/checks/**`, it also changes a
      corresponding fixture under `test/fixtures/tier0/**`. CI enforces
      this; a PR that fails it will not merge.
- [ ] New checks ship with their own isolating fixture in the same PR.
- [ ] If the PR changes any `expected-findings.json` file, the PR
      description states, per fixture: findings added, findings removed,
      findings detail-enriched. Every added or removed finding has
      individual justification.
- [ ] Changes to `expected-findings.json` require review and sign-off from
      a code owner (see `.github/CODEOWNERS`) before merge.
- [ ] No confidence thresholds are hardcoded outside `calibration.json`.

## Filing a bug report

Include a minimal fixture that reproduces the problem. A report without
one is much harder to act on.

## Repository setup this assumes

Branch protection on `main` with "Require a pull request before merging"
and "Require review from Code Owners" enabled — `.github/CODEOWNERS`
has no effect until both are on.
