---
status: accepted
date: 2026-07-06
severity: elevated
---

# ADR-0022: The v0.1.5 pre-tag clause-A confirmation and corpus-roster correction

## Status

Accepted — 2026-07-06.

## Context

ADR-0019 §4 moved the clause-A corpus confirmation ahead of the release tag, so kill clause A's
post-publish window re-confirms a result already established rather than meeting the shipping code
for the first time. Running that confirmation on the v0.1.5 candidate surfaced a problem in the
corpus, not the tool: the fifth external log named in the ratified R5 — the opendatahub
`architecture-decision-records` repository — no longer resolves to a numbered ADR log at its current
public HEAD. It is now a SIG-charter and proposal repository with no `NNNN-title` records, so
duckadrift finds nothing to check, and any earlier differential that cited results from it cannot be
reproduced against what the repository is today.

A corpus member that has drifted out from under the check is the exact failure this tool exists to
name, met on the tool's own doorstep. The honest response is the tool's own: replace the stale
reference and record the scar, rather than quietly keep citing a log that no longer exists.

## Decision

1. **Strike opendatahub from the R5 external corpus and replace it with
   `ministryofjustice/cloud-platform`** — the UK Government Cloud Platform team's
   `architecture-decision-record` log: fifty ADRs in the adr-tools convention, actively maintained,
   no submodules to make resolution depend on checkout state. It was run and triaged clean before
   adoption — two true D7 index-drift findings (ADRs 048 and 049 genuinely absent from the index)
   and accurate, hedged advisories, zero false positives.

2. **Record the clause-A confirmation on the v0.1.5 code.** At the release candidate — the engine
   frozen before this record and its sibling records were committed — Tier 0 emits zero false
   positives across the five external logs (cosmos-sdk, backstage, edgex-docs,
   terraform-provider-proxmox, and ministryofjustice/cloud-platform) and the public fonthead log.
   Every failing finding was triaged individually against its source: the sixteen cosmos-sdk
   index-drift findings, the two on cloud-platform, and the one on fonthead are all genuine index
   omissions, verified file-by-file against each log's own index; the advisories — missing decision
   sections, numbering gaps, site-relative links — are accurate and correctly hedged. This is the
   pre-tag confirmation ADR-0019 §4 requires, on the reachable corpus. The private internal logs and
   the post-publish window complete it.

3. **Document two detection limits the corpus pass surfaced.** duckadrift detects only the
   `NNNN-title` filename convention, not a bare `ADR-7.md` numbered without a title slug; and it
   resolves a link into a git submodule path only when the submodule is checked out, reporting it
   unresolved otherwise. Neither is a false positive — the first is a missed detection, the second is
   correct for the default CI checkout and merely debatable when submodules are initialized — but both
   are real edges. They are recorded in LIMITS and deferred to the M6 backlog, not fixed pre-1.0.

## Consequences

- The clause-A corpus is five valid, diverse external logs again: a large protocol log with genuine
  index drift (cosmos-sdk), two clean logs (backstage, terraform-provider-proxmox), a log with
  space-bearing ADR filenames (edgex-docs), and a large government log with genuine drift
  (cloud-platform) — plus fonthead. The replacement is more diverse than the roster it corrects, not
  merely a like-for-like swap.
- The post-publish window becomes what ADR-0019 intended: a re-confirmation of an established zero-FP
  result plus the two private internal logs the chat seat cannot reach, never the first encounter
  between the corpus and the shipping code.
- The two documented limits are honest silences. The tool says nothing about a number-only log or an
  unchecked-out submodule path, and says so in LIMITS rather than guessing. Fixing either is an M6
  concern; neither touches the wedge (ADR-0018's non-goal line) or the 1.0 gates (ADR-0012).
- The corpus recorded in the private design brief is corrected in the same step — this record names
  the authoritative public corpus; the brief carries the same odh→cloud-platform swap.
