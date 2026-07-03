---
status: accepted
date: 2026-07-02
severity: elevated
---

# ADR-0004: Dialect detection widened for real-world templates

## Status

Accepted — 2026-07-02

## Context

Running Gate G1 against real external repos surfaced two real-world ADR template patterns dialect detection didn't account for, both producing false positives the director verdicted FALSE:

1. Several ADRs use `## Problem` (or `## Problem Statement`) instead of `## Context` — a naming variant, not a missing section. D1 flagged all of them as missing Context.
2. An entire ADR log used zero YAML frontmatter, encoding status as bold prose (`- **Status:** Accepted ...`) under the title instead of a `## Status` heading. D1 misclassified these files against Nygard's structure and flagged several as missing Context, when the file's actual template asserts no such section at all.

## Decision

1. `## Context` is satisfied by any of: `Context`, `Problem`, `Problem Statement` — a section-alias mechanism, extensible to future variants without touching detection logic.
2. A new "loose" dialect is recognized: an ADR whose title-block prose contains a bold `**Status:**` line and has no literal `## Status` heading. Loose asserts zero required sections — a genuinely freer template shouldn't be measured against Nygard's structure at all.

## Consequences

- The alias mechanism is intentionally narrow (one alias list, one required section) rather than a general fuzzy-matching system — broadening it further is a decision for the next real-world pattern that demands it, not something to anticipate now.
- "Loose" asserting zero required sections means a genuinely incomplete loose-dialect ADR (no decision recorded at all) won't be caught by D1. Accepted: asserting a structural requirement duckadrift has no evidence the author intended is worse than staying silent.
- Both patterns were confirmed in the wild, not hypothesized. Running against real external repos, not just curated fixtures, is what surfaced them — fixture-only testing wouldn't have caught either.
