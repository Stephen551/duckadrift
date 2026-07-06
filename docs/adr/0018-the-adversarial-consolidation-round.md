---
status: accepted
date: 2026-07-05
severity: elevated
---

# ADR-0018: The adversarial-consolidation round, and the ambiguity class it surfaced

## Status

Accepted — 2026-07-05.

## Context

Before the Marketplace publish, the pre-publish code was put through a cross-vendor
adversarial round: two uncorrelated external reviewers — one taking a red-team framing
(Codex), one an audit framing (Gemini) — together with the chat verifier's own probes.
Everything reported was reproduced independently against the built tool before it was
treated as real. This is the v0.1.0 and v0.1.1 audit lineage (ADR-0013, ADR-0014) applied
to the release that starts clause A's clock.

The round opened on five false positives, found across the external R5 corpus and the
verifier's own attack surface: angle-bracket link destinations and link titles read as
dangling references (D3); a parenthesised index entry truncated at its first paren (D7);
a per-directory supersession cycle fabricated by a bare-number graph (D2); and an index
entry whose existence check reached outside the repository (D7 — a filesystem-existence
oracle a fork could read through CI pass or fail).

The five were not five bugs. They were three primitives kept in duplicate — link parsing,
number-scoping, and path containment — where hardening applied to one copy never reached
its siblings. That is the exact drift class the tool exists to catch, found inside the
tool. The fix was consolidation onto single shared helpers, not five separate patches, so
that a future hardening reaches every caller at once.

Consolidation is a large enough change to introduce its own defects, and it did. The value
of the round is that each was caught before the publish, by the layer built to catch it.

## Decision

1. **The three primitives are consolidated onto shared helpers.** One CommonMark-correct
   link parser (`parse.ts`), adopted by D3 and D7; one repo-containment primitive
   (`existsWithinRepo` / `escapesRepoRoot`, `paths.ts`), adopted by D3 and D7; and a
   directory-scoped D2 supersession graph keyed by filename rather than bare number, across
   the cycle, mutual, and stale checks. The five founding false positives are closed at the
   primitive, not the instance.

2. **The linear title-strip.** The consolidated parser's first trailing-title
   implementation was quadratic on a long internal whitespace run followed by an
   unterminated title token — the catastrophic-backtracking class S6 already hardened,
   reintroduced in new code, and reachable from untrusted fork content (a crafted ADR ran
   the checker for nearly two minutes). It was caught by the verifier's own probe of the new
   parser, not by any fixture, and replaced with a linear scan. A permanent bounded-time
   fixture locks it.

3. **The `X (suffix)` ambiguity is advisory — never silent, never a hard fail.** Because the
   tool deliberately accepts unescaped spaces in bare destinations (real MkDocs image paths
   depend on it), a destination like `my folder (v2)` is genuinely ambiguous: the
   parentheses may be part of a real filename, or a Markdown title over a broken link. The
   tool cannot read the author's intent. Three findings turned out to be one class — a real
   path hard-failed after title-stripping (a regression the consolidation introduced); a
   broken link passed silently when a decoy file matched the raw form (pre-existing); and a
   site-relative link ending in parentheses hard-failed instead of surfacing as advisory
   (a regression). The resolution is a ladder that runs the full resolution path — direct,
   then site-relative basename — on both the title-stripped and the raw forms, and when a
   link resolves only via the raw form, surfaces it as **advisory**: the ADR-0011 pattern
   (provably a same-named file exists, not provably an error), and the Pact applied honestly
   — a silent pass sends a finding to /dev/null, a hard fail false-flags a real path. Only a
   link that resolves under no reading is a failing dangling finding.

4. **One shared percent-decode closes the D3/D7 divergence.** `decodeTarget` moved to
   `parse.ts` and is used by both checks, so a `%20`-encoded index entry and its
   spaced-name file resolve identically. Before this, D3 decoded and D7 did not — the exact
   primitive-divergence this round exists to kill.

5. **Three edges are deferred, on the record, not hidden.** First: an index entry written as
   a percent-encoded *absolute* path (`%2F…`) resolves differently in D3 and D7 — a
   non-failing inconsistency on synthetic input, whose impact the shared-decode fix reduced
   rather than created; a filename encoded that way is not something a real log carries.
   Second and third: character and entity references in link destinations (`a&amp;b.ts`,
   `https&#58;//…`) are not decoded, and escaped-quote link titles (`"my \"title\""`) are not
   stripped — both pre-existing before this round, both requiring input a reasonable log does
   not carry, and entity handling is a genuine feature rather than a fix. The tool's own
   doctrine is that every finding is surfaced; a recorded limitation is surfaced. These wait
   for a later release, named here so the record is honest about what the round did and did
   not close.

## Consequences

- The founding false-positive class is closed at the primitive: link parsing, containment,
  and number-scoping each have one implementation now, so the next hardening cannot miss a
  sibling. The specific drift class that motivated the tool no longer lives inside it.
- Advisory is now the established treatment for the case where a file provably exists but the
  reference is not provably an error — the ADR-0011 principle generalised from site-relative
  links to the title-versus-path ambiguity. The failing tier stays reserved for the provable
  dangle.
- The round validated the gate, not only the code. Every defect the consolidation introduced
  — the quadratic title-strip, and both `X (suffix)` hard-fails — was caught before the
  publish: the verifier's own probe for the first, the uncorrelated vendors for the others,
  each reproduced independently. This is the ADR-0013 and ADR-0014 adversarial practice
  continued into the release that starts clause A's clock, and it earned its place: a
  differential and a single reviewing seat would have shipped the site-relative regression.
- The deferrals are the standing work for a later release. None is a clause-A trip — clause
  A halts on surviving false positives, and the deferred edges are either non-failing or
  require input no real log carries — and none blocks the publish. They are recorded so the
  next round starts from the real state.
