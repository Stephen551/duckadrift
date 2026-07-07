# Privacy guard

This repository is public; several of the maintainer's other project names are not. The guard
keeps those names out of the public tree and history. It is deliberately the tool's own
doctrine turned on itself: don't trust a local claim, verify it in CI.

## One scanner, two layers

Both layers call the same committed scanner, `scripts/privacy-scan.mjs`, so they can never
drift apart:

- **Local hook (fast feedback).** `.git/hooks/pre-commit` runs the scanner over staged files
  before each commit, reading forbidden names from `.privacy-denylist.local` (gitignored — the
  names never land in the repo). It can be skipped with `--no-verify`, which is why the second
  layer exists.
- **CI (the net).** `.github/workflows/privacy-guard.yml` runs the same scanner over the whole
  tree on every push and same-repo PR, reading names from the `PRIVACY_DENYLIST` repo secret.
  It runs server-side, cannot be `--no-verify`'d away, and — unlike a local hook — is
  reviewable and testable in the repo. In CI mode the scanner redacts any matched name from
  the log, so a public Actions log never echoes a private name.

## The allowlist

`.privacy-allowlist` (committed) lists names that are permitted despite matching a denylist
entry — deliberate, auditable exceptions. `fonthead` lives here: it is a public repo, named in
the record by director decision, so it is allowed rather than bypassed.

## Setup

1. Set the `PRIVACY_DENYLIST` repo secret to the forbidden names, one per line. Until it is
   set, the CI guard warns but does not block.
2. Locally, put the same names in `.privacy-denylist.local` (gitignored) so the pre-commit
   hook enforces them too.
3. Install the hook (`.git/hooks/pre-commit`, see the reference in the guard handoff).

## Changing the lists

- Permit a name that is safe to appear: add it to `.privacy-allowlist`.
- Add a name to protect: add it to the `PRIVACY_DENYLIST` secret and to `.privacy-denylist.local`.

Entries are matched case-insensitively as substrings, so a name, its capitalization variants, and glued
forms (e.g. `ExampleName`, `examplename`, `examplenameRepo`) are all caught. Keep entries distinct (four characters or more) to avoid over-matching.
