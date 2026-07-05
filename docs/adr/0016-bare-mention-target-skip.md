---
status: accepted
date: 2026-07-04
severity: elevated
---

# ADR-0016: A bare `@` link target is a mention, not a dangling reference

## Status

Accepted — 2026-07-04.

## Context

The pre-publish clause-A pass surfaced a D3 false positive that fails CI.
opendatahub's ADR-0007 cites its reviewers in an author table using
GitHub-attribution mentions — `[Steven Tobin](@StevenTobin)` — and leaves some
handles blank: `[Chris Sams](@)`. D3 flagged the blank ones as fact-tier dangling
references — "ADR-0007 links to `@`, which does not resolve at HEAD" — failing the
build on two of them.

D3 already skips a filled attribution mention: `[Name](@handle)` is recognized as a
GitHub-username idiom, not a repo path, and is not existence-checked. A bare `@` was
deliberately excluded from that skip — a prior source comment held that an empty
handle was "an evidently unfilled attribution slot" that "correctly falls through to
normal existence checking." That reasoning was wrong. A bare `@` is the same idiom
as a filled handle with the handle left empty; it is no more a repo-relative file
reference than `@StevenTobin` is. The flag fired not because `@` names a missing file
but because the skip pattern required at least one character after the `@` — the
"unfilled slot" gloss was a rationalization of a regex boundary, not a distinction in
kind. Failing a merge because an author left a GitHub handle blank is the siren
firing on the wrong class of thing: a false positive of exactly the shape the
clause-A gate exists to catch.

## Decision

A bare `@` target is treated as a mention and skipped, like a filled handle: the
username-mention pattern's handle is made optional.

The narrowness is deliberate and preserved. A scoped-package target —
`@scope/name`, `@backstage/core-plugin-api` — always carries a `/`, still does not
match the mention pattern, and is still existence-checked. That existence check is a
decision in its own right: an unanchored `/^@/` skip was previously rejected
precisely because it would swallow scoped-package targets and turn a genuine dangling
package reference into a false negative. This ADR reverses only the
bare-`@`-flags-as-dangling behavior; the scoped-package rule stands untouched.

This correction is recorded on the log, not quietly patched. The prior position lived
in a source comment asserting the opposite, and that comment remains in git history.
A tool whose premise is that a decision must be checked against reality — and that
flags contradiction between decisions in the logs it audits — adds the corrected
decision to its own record rather than erasing the mistake from it.

## Consequences

- opendatahub's two bare-`@` false positives clear. Its duplicate-number and
  cross-directory numbering findings still fire — all true positives — so the log
  went from twelve findings to ten, verified on the fixed build.
- The skip is proven narrow against every boundary case: a bare `@` and a clean
  `@handle` skip; every `/`-bearing package target and every malformed form
  (`@-foo`, `@@`, `@a.b`) stays existence-checked; a genuinely dangling repo link
  still fails.
- One existing fixture oracle changes under `ADR-ACK: 0002`: `d3-scoped-package-target`
  drops the bare-`@` finding and keeps the `@myscope/missing-plugin` dangling finding.
  That fixture already carried all four cases — a filled handle, a bare `@`, a
  resolving scoped package, and a dangling one — so it is itself the isolating proof
  that only the false positive was removed and the scoped-package existence check
  survived.
