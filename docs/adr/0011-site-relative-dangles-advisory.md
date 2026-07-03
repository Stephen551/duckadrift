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

The dominant version of this idiom is extensionless and often trailing-slash —
`../../adr/foo/`, not `../../adr/foo.md` — the "pretty URL" convention MkDocs and
Docusaurus both use, mapping either to a same-named `.md` source file or to a
per-page directory with an `index.md` inside. edgex-docs's own ADR-0026 finding
(`../../adr/0005-Service-Self-Config/`) is exactly this shape, caught in verifier
review: the first cut of this ADR's basename matcher used a plain
`target.split("/").pop()`, which returns an empty string for any trailing-slash
target — silently failing to match anything, ever, for the single most common form
of the idiom this ADR exists to handle.

## Decision

When a link fails to resolve under D3's existing rules, it now falls back to a
repo-wide search by basename (reusing `walkRepoFiles`'s directory-exclusion list via
a new sibling function, `walkAllPaths`, which skips content-reading and extension
filtering since the target could be any file type — a `.proto`, an image, anything a
relative link might cite). The target is normalized before the search: a trailing
slash is stripped, and if the resulting slug has no extension of its own, two
completions are tried in addition to the bare slug — `<slug>.md` and
`<slug>/index.md` — the two source shapes the extensionless "pretty URL" idiom maps
to. If any candidate matches a file that exists anywhere in the repo, the finding
downgrades to advisory, with the discovered path folded into both the claim
("possibly site-relative — found at `<path>`") and the evidence array, so a human can
jump straight to it. A target with no match anywhere in the tree, under any
candidate, has nothing to explain it away with — stays fact, exactly as before.

This is a provable-state, not provable-error, distinction, the same shape as
ADR-0009 and ADR-0010: the tool can prove the file exists somewhere; it cannot prove
the specific link is wrong for this repo's publishing setup.

## Consequences

- cosmos-sdk's ADR-054 finding (a plain `module.proto` basename, no trailing slash)
  downgrades to advisory under the first cut of this ADR. edgex-docs's ADR-0026
  finding (the trailing-slash, extensionless idiom) required the normalization fix
  above to downgrade — caught in verifier review before merge, not after.
- No existing fixture's oracle changes: every prior D3 fixture's seeded dangling
  link has no matching basename (with or without the new normalization) anywhere in
  its fixture tree, confirmed by full suite re-run both before this ADR landed and
  after the normalization fix.
- Two new fixtures are the isolating proof: `d3-site-relative-dangle` (a plain-
  basename match, no trailing slash — the cosmos-sdk shape) and
  `d3-site-relative-extensionless` (trailing-slash targets resolving via both the
  `.md`-completion and `index.md` candidates, plus a negative control that still
  stays fact after normalization) — the edgex-docs shape, added once the gap was
  found.
- `walkAllPaths` duplicates `walkRepoFiles`'s directory-traversal logic rather than
  refactoring it into a shared internal — that function is already fixture-verified
  and load-bearing for D4; a second, simpler walker was judged safer than
  restructuring it.
