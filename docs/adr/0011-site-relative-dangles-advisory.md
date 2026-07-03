---
status: accepted
date: 2026-07-03
severity: elevated
---

# ADR-0011: Site-relative dangling links go advisory when a match exists elsewhere

## Status

Accepted — 2026-07-03.

## Context

Doctrine Q3 (R5's triage doc): two D3 findings — edgex-docs's ADR-0026 and
cosmos-sdk's ADR-054 — cite paths that don't resolve under any of D3's existing
resolution rules (ADR-dir-relative, repo-root-relative, or the leading-slash
repo-root convention), but whose target file genuinely exists somewhere else in the
repository. Both read as links written for a published documentation site's URL
depth rather than the raw git tree (an MkDocs/Docusaurus-style authoring habit).
D3's claim ("does not resolve at HEAD") was literally true of the raw tree either
way — the open question was never the claim's accuracy, only whether fact-tier is
the right confidence level when the cited file demonstrably exists, just not where
the link says.

## Decision

When a link fails to resolve under D3's existing rules, it now falls back to a
repo-wide search by basename (reusing `walkRepoFiles`'s directory-exclusion list via
a new sibling function, `walkAllPaths`, which skips content-reading and extension
filtering since the target could be any file type — a `.proto`, an image, anything a
relative link might cite). If a file with the same basename exists anywhere in the
repo, the finding downgrades to advisory, with the discovered path folded into both
the claim ("possibly site-relative — found at `<path>`") and the evidence array, so a
human can jump straight to it. A target with no match anywhere in the tree has
nothing to explain it away with — stays fact, exactly as before.

This is a provable-state, not provable-error, distinction, the same shape as
ADR-0009 and ADR-0010: the tool can prove the file exists somewhere; it cannot prove
the specific link is wrong for this repo's publishing setup.

## Consequences

- edgex-docs's ADR-0026 and cosmos-sdk's ADR-054 findings both downgrade to
  advisory, assuming their real targets are found elsewhere in the tree (confirmed
  by direct repo inspection during the R5 exam, before this ADR).
- No existing fixture's oracle changes: every prior D3 fixture's seeded dangling
  link has no matching basename anywhere in its fixture tree, confirmed by full
  suite re-run before this ADR landed.
- A new fixture, `d3-site-relative-dangle`, is the isolating proof — one link with a
  same-basename match elsewhere (advisory) and one with no match anywhere (fact),
  side by side in the same repo.
- `walkAllPaths` duplicates `walkRepoFiles`'s directory-traversal logic rather than
  refactoring it into a shared internal — that function is already fixture-verified
  and load-bearing for D4; a second, simpler walker was judged safer than
  restructuring it.
