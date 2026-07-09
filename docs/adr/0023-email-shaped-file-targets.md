---
status: accepted
date: 2026-07-09
severity: elevated
---

# ADR-0023: Email-shaped targets with file extensions surface as advisories

## Status

Accepted — 2026-07-09.

## Context

ADR-0016 established the attribution-idiom skips: a bare `@handle` mention and a bare
email (`chris@redhat.com`) are people, not paths, and existence-checking them produced
clause-A false positives on real corpus logs. The email skip was shape-based: anything
matching one-`@`-then-domain-shaped was skipped.

Issue #2 named the counter-case the shape test cannot see: `author@notes.md` is
domain-shaped — `.md` is Moldova's actual top-level domain — but it is at least as
plausibly a file whose name contains an `@`. Under the ADR-0016 skip, if that file
reference dangles, it dangles silently: a false negative, and a silent one, which the
Pact treats as its own violation class. The inverse fix — existence-checking these as
fact-tier findings — would manufacture the original failure again: a genuine Moldovan,
Serbian (`.rs`), or St Helenian (`.sh`) email attribution would fail CI, a clause-A
false positive with the window running.

## Decision

An email-shaped target whose final dot-segment is a known file extension (a fixed,
deliberately file-signal-heavy list that excludes common email TLDs) is not skipped. It
goes through the shared resolver like any path. If it resolves, there is no finding. If
it dangles, D3 emits an advisory — never a fact-tier finding — whose claim states both
facts that are true under either reading: the target is shaped like an email address,
it ends in a file extension, and it does not resolve as a file at HEAD. The consequence
names both dispositions and how to disambiguate: `mailto:` for an email, a resolving
path for a file.

Email-shaped targets without a listed extension are skipped exactly as ADR-0016
decided. The mention skip is untouched; its shape already forbids dots.

## Consequences

- The false-negative class is closed: an email-shaped dangling file reference now
  surfaces, satisfying "every finding is surfaced."
- The advisory channel absorbs the irreducible ambiguity. A rare genuine `.md`/`.rs`/
  `.sh` email attribution will draw one advisory whose claim is still factually
  accurate; it never fails CI, so kill clause A is not exposed.
- The extension list is a classification heuristic, not a threshold; it lives as a
  named constant beside the regex it guards, with the collision rationale recorded at
  the definition site.
