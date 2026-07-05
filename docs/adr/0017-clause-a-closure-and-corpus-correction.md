---
status: accepted
date: 2026-07-04
severity: elevated
---

# ADR-0017: Clause A closure, and the corpus correction it forced

## Status

Accepted — 2026-07-04.

## Context

Kill clause A — the tool-quality kill — requires that within fourteen days of the M2
gate, Tier 0 runs against the full validation corpus (the internal ADR logs plus the
five external R5 repositories) and that not one Tier 0 false positive survives
triage. A deterministic checker that is sometimes wrong burns the exact trust the
tool exists to protect, so the bar is zero, not few.

The clause was run before the Marketplace publish rather than after, deliberately:
the last full external validation was at v0.1.0, three releases stale, and the code
had changed substantially since. That decision paid for itself. The external pass
surfaced two false-positive classes — a plural `## Decisions` heading read as a
missing decision section, and a bare `@` author-mention link flagged as a dangling
reference — both fixed in v0.1.4 and recorded in ADR-0015 and ADR-0016. The clause
was then re-run in full at v0.1.4.

Running the internal half of the corpus established something the external pass could
not: the corpus is not the one the founding document declared. That document
specified the internal corpus as four private repositories, each carrying forty or
more real ADRs. The clause-A run found the reality — two internal logs of real depth
(fifty-three ADRs each), one thin log (four ADRs), and one repository that is a web
project with no ADR log at all. The coverage guard correctly refused to certify the
last as a pass: a scan of a repository with zero ADRs certifies nothing, and reporting
it as clean would have been a false pass, which is worse than a real finding.

## Decision

1. **Clause A is met.** At v0.1.4, across every corpus repository that has an ADR log
   — the two deep internal logs, the thin internal log, and all five external R5
   repositories — zero Tier 0 false positives survive triage. The kill condition is
   not tripped, and the clause-A precondition on Gate G2 is cleared. Whether to
   publish remains the director's deliberate act.

2. **The web project is struck from the corpus by category, not scanned harder.** A
   web project has no architecture-decision log by nature; it was never a repository
   the ADR corpus applied to. Its inclusion in the original count was a category
   error, and the correct fix is to correct the count, not to hunt for a log that
   does not exist.

3. **The corpus claim is corrected to what exists.** The founding document's "four
   repositories, forty-plus ADRs each" is now known to be false in two places: one
   internal log holds four ADRs, not forty, and one named repository holds no ADR log
   at all. The real labeled corpus is three internal logs — two deep, one thin — plus
   the five external repositories. It still clears M4's target of at least two hundred
   labeled findings comfortably: the two deep logs and the external repositories carry
   several hundred ADRs between them, and one Tier 1 run over that surface produces far
   more than two hundred findings to label. It still contains the recurring-revision
   specimen the S4 demo depends on. The moat survives; the sentence describing it did
   not, and is corrected on the record.

4. **One true positive surfaced in the internal run, logged for repair.** One internal
   log carries an ADR whose body links to an absolute local filesystem path that does
   not resolve in the repository — genuine drift, correctly caught. It is a true
   positive, not a clause-A trip (clause A halts only on false positives), and its
   repair belongs to that repository, not to duckadrift.

## Consequences

- Gate G2 — the Marketplace publish that starts clause A's fourteen-day clock — is now
  clear of its clause-A precondition: every real ADR log in the corpus scanned at
  v0.1.4, zero surviving false positives, corpus claim honest.
- The M4 calibration corpus is recomposed: three internal logs plus five external
  repositories, not four internal. The at-least-two-hundred-finding target is
  unaffected; the "four rich logs" framing is retired.
- The founding document is a gitignored planning artifact and cannot carry this
  correction itself; this ADR is the in-repo, public record of it. A tool whose
  premise is that a recorded claim must be checked against reality corrects its own
  founding claim on the log rather than leaving it standing.
- The internal run also demonstrated the enforcement working on real drift: the tool
  caught a genuine broken link in its own extended dogfood corpus — the behavior the
  whole project exists to produce.
