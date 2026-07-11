# M4.2 diff-mode yield table (DIFF-YIELD)

Sibling of YIELD.md (whole-log, untouched). Captured 2026-07-11 per ADR-0041: real
first-parent commit history as the PR proxy, deterministic selection (newest-first, cap 8
per repo per check, ADR dir non-empty at the commit), guarded worktrees that refuse any
SHA but the recorded one. Same key {api, claude-sonnet-5, high}, same sync transport,
same checkpointed capture (ADR-0037), same privacy split (ADR-0040 — the two private
repos' diff recordings are local-only). Costs measured from usage siblings at Sonnet 5
introductory rates. Counts from replaying every recording through the production
pipeline in the reconstructed worktree — full trees at the candidate SHA (the corrected
pass; accepted/livePremises/discarded shown per row, lp structurally 0 for S2/S3).

## Probe and gate (the money record)

- Probe tranche (first 10 paid calls): $0.13907, avg $0.01391/call → projection $0.65 — proceed.
- Re-check after every call tripped at $1.52623 + $2.82 projected > $4.00, driven by
  cosmos-sdk S3 (dependency-bump commits whose manifests at HEAD are giant): cosmos avg
  $0.34/call vs $0.011 for everything else. **Routed to the director; ruling: drop
  cosmos's 4 uncaptured candidates, keep its 4 captured ones.** Exclusion recorded below
  and in harvest.json.
- Resumed post-ruling probe re-measured $0.03572/call avg → projection $0.54 — proceed.
- **Final diff-ledger: $2.49182. The $4.00 gate held.** Combined corpus spend
  (whole-log + diff): $5.38321.

| repo | candidates (S3+S2) | calls captured | named skips | accepted / lp / discarded | repo cost | cumulative |
|---|---|---|---|---|---|---|
| duckadrift | 7+8 | 15 | 0 | 0f / 0lp / 0d | $0.17477 | $0.17477 |
| fonthead | 1+0 | 1 | 0 | 1f / 0lp / 0d | $0.00586 | $0.18062 |
| cosmos-sdk | 4+0 | 4 | 0 | 2f / 0lp / 0d | $1.34561 | $1.52623 |
| backstage | 8+0 | 2 | 6 | 1f / 0lp / 0d | $0.13263 | $1.65887 |
| edgex-docs | 0+0 | 0 | 0 | 0f / 0lp / 0d | $0.00000 | $1.65887 |
| terraform-provider-proxmox | 8+0 | 8 | 0 | 1f / 0lp / 0d | $0.34527 | $2.00414 |
| cloud-platform | 8+0 | 7 | 1 | 1f / 0lp / 0d | $0.04135 | $2.04549 |
| first-internal-log | 8+0 | 8 | 0 | 21f / 0lp / 0d | $0.21714 | $2.26263 |
| second-internal-log | 1+0 | 1 | 0 | 1f / 0lp / 0d | $0.22919 | $2.49182 |

**Totals: 28 accepted findings (6 public + 22 private) from 46
captured calls + 7 named skips. Every finding is S3 — citing no decision record, deriving
ROUTINE severity (ADR-0038 default) — so this corpus feeds the routine floor (0.95), as
ADR-0041 states. S2 harvested 8 candidates (duckadrift-only, the sole governs: user) and
yielded 0 accepted findings; duckadrift's own 15 diff calls yielded 0 total — its manifest
changes are recorded in its log, so the unrecorded-decision check correctly stands down.**

## Named skips

- backstage: fe246c7a4a26 S3 cap-skip 1750495B; 3b4e16b8018c S3 cap-skip 1757149B; 5c3355841e28 S3 cap-skip 1769781B; 51169d3f9b58 S3 cap-skip 1749074B; cae4ca537e6f S3 cap-skip 1783811B; 34dbe200c0d7 S3 cap-skip 1757482B
- cloud-platform: e729e1631896 S3 no-input (changed manifest deleted at commit)

backstage's six cap-skips are ADR-0032 working: its dependency commits change a ~1.75MB
lockfile, and a log too large for one call is skipped aloud, never trimmed in silence.

## PR-proxy caveat (ADR-0041)

All six remote publics use squash-or-merge GitHub flows, so first-parent commits ARE
PR-sized units there. duckadrift and the internal repos carry direct commits; their diffs
are commit-sized, which is finer than PR-sized — the caveat runs the other direction and
is noted rather than corrected.

## The selected candidates (the reproducible corpus)

- **duckadrift** (public, HEAD f68c95e225f9, first-parent depth 78, governs-ADRs today: 1)
  - S3: ab976532fba6, 77451708daee, 375327797f87, 84fe3a777ae7, 20435e861f96, 48bc5640ff57, 2101139c10e7
  - S2: 756fc1a89764, 010ecbf2d770, a5d9e0b0a04a, 5b3102cee07e, b0d593763419, 5271aed7798e, cbde7be042f8, 1d5cd50ac3c8
- **fonthead** (public, HEAD 865127ad9be4, first-parent depth 370, governs-ADRs today: 0)
  - S3: 38befecbe7af
  - S2: (none)
- **cosmos-sdk** (public, HEAD 315d7ce75a23, first-parent depth 10639, governs-ADRs today: 0) — gate exclusion: b0eca73c286f, 5f1d8655aa42, 8bc1dc2ca7f2, fcdc5aa79154 (projection-gate ruling 2026-07-11: cosmos S3 calls measured $0.34/call avg (giant manifests at HEAD); director dropped the 4 uncaptured candidates)
  - S3: ffe084d03236, 8d9be74a68d1, a45437c55b4c, b9a11304cf56
  - S2: (none)
- **backstage** (public, HEAD 61bb32db5c6b, first-parent depth 21334, governs-ADRs today: 0)
  - S3: fe246c7a4a26, 86eaafb78adf, 3b4e16b8018c, 5c3355841e28, 29397654e29a, 51169d3f9b58, cae4ca537e6f, 34dbe200c0d7
  - S2: (none)
- **edgex-docs** (public, HEAD e204cc7b6e07, first-parent depth 782, governs-ADRs today: 0)
  - S3: (none)
  - S2: (none)
- **terraform-provider-proxmox** (public, HEAD 04894bdf3c23, first-parent depth 2358, governs-ADRs today: 0)
  - S3: 7cef701a9cd0, 667f65f0e733, 94dfe53a60e4, 804860f6252a, 5bedef142033, f95abbc00c87, d59b7bb71b88, b0c896ed6d80
  - S2: (none)
- **cloud-platform** (public, HEAD dab45455f22f, first-parent depth 1577, governs-ADRs today: 0)
  - S3: 07d3f0ff3e29, 3771d3c6bce3, cd1fb86f269a, 249d1bea2d98, e9e764d2f6bf, e729e1631896, e41b0b03e2dd, 2a6d679ff546
  - S2: (none)
- **first-internal-log** (private, HEAD bf829c36ef58, first-parent depth 142, governs-ADRs today: 0)
  - S3: 8b00a4cb5c95, f5dc0c278b68, 1bae60db8fdf, 9fd7228a0804, e4aacd51c44f, 8677a884dbd3, 9251323330cc, 96c43a380937
  - S2: (none)
- **second-internal-log** (private, HEAD d9cb1796bff5, first-parent depth 247, governs-ADRs today: 0)
  - S3: 56d0fccbed78
  - S2: (none)
