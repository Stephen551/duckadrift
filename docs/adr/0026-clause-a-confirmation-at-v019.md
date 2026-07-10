---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0026: Kill clause A — confirmation at v0.1.9

## Status

Accepted — 2026-07-10.

## Context

Kill clause A (PDR §1.5) requires, within fourteen days of the Marketplace listing,
a Tier 0 run across the full corpus with every finding hand-triaged — one false
positive surviving triage halts the project's semantic-tier work and forces a
re-architecture of the failing check. The listing went live 2026-07-09 at v0.1.8;
the listed version moved to v0.1.9 the same day, carrying two D3 refinements
(ADR-0023, ADR-0024) and the D5 ack-source fix (ADR-0025). This record closes the
confirmation at v0.1.9, on the day after the clock started. The CI watch on every
installed repository continues through the window's end regardless — a confirmation
is a snapshot; the watch does not stand down.

The corpus, fully qualified — recorded with owners because this round demonstrated
why: the roster's prior shorthand "terraform-provider-proxmox" (ADR-0022) matches two
GitHub repositories, and the verifier initially cloned the wrong one
(`Telmate/terraform-provider-proxmox`, which has no ADR log) before reaching the
corpus member. External: `cosmos/cosmos-sdk`, `backstage/backstage`,
`edgexfoundry/edgex-docs`, `bpg/terraform-provider-proxmox`,
`ministryofjustice/cloud-platform`, plus public `Stephen551/fonthead`. Internal
(private, run via installed CI): the two internal product logs.

## Decision

Clause A is confirmed at v0.1.9: **zero surviving Tier 0 false positives across the
corpus.**

External tallies, every finding independently re-derived by the verifier against the
working tree using detectors deliberately simpler than the engine's (raw index
substring scans, direct path-existence tests, heading greps — same facts, different
machinery): cosmos-sdk 35 findings, 35 true (including all fifteen claimed numbering
gaps verified absent on disk, and the three-file ADR-050 annex cluster matching the
advisory's own hedged reading); cloud-platform 9, all true; edgex-docs 5, all true;
fonthead 2, all true; backstage and terraform-provider-proxmox clean. Fifty-one
findings, fifty-one true.

Internal tallies: the first internal log emitted 18 findings (5 failing D3, 13 advisory D1),
identical in count, tier split, and spot-checked content to the set fully triaged
true at v0.1.7 — including a genuine leaked local absolute path in one record, the
corpus's known specimen, repaired by its owner after the snapshot rather than before
it so the record shows the catch. The second internal log ran clean. Both runs
resolved `@v0` to duckadrift 0.1.9 in their logs.

One false positive was found during the window, and it is part of this record rather
than a footnote to it: the D5 ack-source false positive (ADR-0025), emitted by the
tool's own dogfood on its own pull request #27 — the gate could not see an `ADR-ACK`
marker placed exactly where the documented contract and this repository's own law
prescribe. It was triaged same-day, root-caused to the action wrapper, fixed, and the
fix shipped in v0.1.9 before any version carrying the defect was published. Under the
clause's own standard it did not survive triage. It is counted, named, and closed —
not excused.

## Consequences

- The clause-A gate on Tier 1 work is open: M3 may begin.
- The watch continues: all three internal logs and fonthead run the action in CI on
  every pull request and on schedule through 2026-07-23 and beyond; any finding they
  surface joins this ledger honestly, confirmation notwithstanding.
- The corpus roster is now recorded with owner-qualified names; future confirmations
  clone from this record, not from shorthand.
- The false-positive ledger stands at one found, zero surviving. The dogfood loop —
  not the verifier's eleven-probe engine review — caught it, which is recorded as the
  argument for the loop's existence and for the verifier checklist item ADR-0025
  added.
