# M4.1 corpus yield table

Captured 2026-07-11 through the ADR-0037 checkpointed path, synchronous Messages API only
(ADR-0040 — batch would not replay). Calibration key: `{backend: api, model:
claude-sonnet-5, effort: high}`, forced by the orchestrator regardless of target-repo
config. Costs computed from the measured `.usage.json` siblings at Sonnet 5 introductory
rates ($2/$10 per 1M, cache write ×1.25, read ×0.10) — measured, never estimated (PDR
§2.8). Accepted counts are the merged ADR-0039 recognizer's. The two private rows are
genericized per ADR-0040; their recordings, usage, and review files exist only on the
director's machine under the gitignored `calibration-corpus/private/`.

| repo | HEAD (captured at) | accepted ADRs | log bytes | per-check: findings · tokens · cost | repo cost | cumulative |
|---|---|---|---|---|---|---|
| duckadrift | 0597fee7bc50 | 40/40 | 146,664 | S1: 0f · 57K in/34 out · $0.1160<br>S4: 2f · 57K in/1370 out · $0.1295<br>S5: 0f · 57K in/34 out · $0.1163 | $0.3618 | $0.3618 |
| fonthead | 865127ad9be4 | 50/53 | 141,835 | S1: 0f · 64K in/34 out · $0.1251<br>S4: 0f · 64K in/1285 out · $0.1376<br>S5: 15f · 64K in/4805 out · $0.1728 | $0.4355 | $0.7973 |
| cosmos-sdk | 315d7ce75a23 | 22/62 | 234,729 | S1: 0f · 91K in/34 out · $0.1792<br>S4: 0f · 91K in/34 out · $0.1792<br>S5: 0f · 91K in/762 out · $0.1865 | $0.5448 | $1.3421 |
| backstage | 61bb32db5c6b | 0/16 | 0 | S1: no-input<br>S4: no-input<br>S5: no-input | $0.0000 | $1.3421 |
| edgex-docs | e204cc7b6e07 | 2/31 | 8,919 | S1: 0f · 5K in/34 out · $0.0074<br>S4: 0f · 5K in/34 out · $0.0074<br>S5: 0f · 5K in/34 out · $0.0074 | $0.0222 | $1.3643 |
| terraform-provider-proxmox | 04894bdf3c23 | 8/8 | 106,598 | S1: 0f · 43K in/34 out · $0.0834<br>S4: 0f · 43K in/730 out · $0.0904<br>S5: 12f · 43K in/4725 out · $0.1303 | $0.3041 | $1.6684 |
| cloud-platform | dab45455f22f | 34/49 | 86,965 | S1: 1f · 37K in/452 out · $0.0752<br>S4: 1f · 37K in/1154 out · $0.0822<br>S5: 0f · 37K in/34 out · $0.0710 | $0.2284 | $1.8968 |
| first-internal-log | (local) | 42/53 | 298,440 | S1: 0f · 132K in/701 out · $0.2671<br>S4: 0f · 132K in/565 out · $0.2658<br>S5: 21f · 132K in/13036 out · $0.3905 | $0.9235 | $2.8202 |
| second-internal-log | (local) | 4/4 | 20,839 | S1: 0f · 10K in/34 out · $0.0178<br>S4: 0f · 10K in/34 out · $0.0178<br>S5: 2f · 10K in/1812 out · $0.0356 | $0.0712 | $2.8914 |

**Totals: 54 accepted findings across 24 captured calls (+3 honest backstage
no-input skips; zero cap-skips — every accepted log fits the 600KB ADR-0032 bound).
Total measured spend $2.89139. The $6.00 stop-gate never tripped.**

Findings counts are the production replay pipeline's accepted findings (citation-validated,
S5 dead-premise-confirmed at replay time per ADR-0036); discards and live premises are
counted in the run logs, not silently dropped. The build plan's open question — do internal
logs yield like fonthead (~1 finding/call) or richer — is answered: the corpus yields
**54 findings from 24 calls (~2.3/call)**, dominated by S5
(50 of 54); S1 yields 1 and S4 yields 3 across all nine repos. M4.2's diff-mode
capture should size against an S1/S4-poor, S5-rich distribution.
