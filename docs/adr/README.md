# ADR index

Architecture decisions for duckadrift itself, recorded in duckadrift's own vocabulary from day one — this log is a demo surface and a dogfood corpus, not just internal record-keeping.

| ADR | Title | Status | Severity |
|-----|-------|--------|----------|
| [0001](0001-governing-principle.md) | The governing principle (the Pact) | Accepted | critical |
| [0002](0002-oracle-update-policy.md) | Oracle-update policy | Accepted | critical |
| [0003](0003-tier1-relevance-gate-and-cost-engineering.md) | Tier 1 relevance gate and cost engineering | Accepted | elevated |
| [0004](0004-dialect-detection-widened.md) | Dialect detection widened for real-world templates | Accepted | elevated |
| [0005](0005-fact-vs-advisory-declared-dialect.md) | Fact-vs-advisory — structural claims require a declared dialect | Accepted | critical |
| [0006](0006-loose-dialect-correction.md) | Correction — loose dialect still checks Context/Decision, always advisory | Accepted | elevated |
| [0007](0007-recursive-discovery-and-coverage-disclosure.md) | Recursive ADR discovery, and coverage disclosure as a standing doctrine | Accepted | critical |
| [0008](0008-directory-scoped-numbering.md) | The numbering namespace is the directory, not the whole ADR root | Accepted | elevated |
| [0009](0009-annex-companion-numbering.md) | Annex-companion same-directory duplicates go advisory | Accepted | elevated |
| [0010](0010-numbering-gaps-advisory.md) | Numbering gaps are advisory by default | Accepted | elevated |
| [0011](0011-site-relative-dangles-advisory.md) | Site-relative dangling links go advisory when a match exists elsewhere | Accepted | elevated |
| [0012](0012-what-1.0-means.md) | What 1.0 means | Accepted | elevated |
| [0013](0013-the-v0.1.0-adversarial-audit.md) | The v0.1.0 adversarial audit, and what it exposed | Accepted | elevated |
| [0014](0014-the-v0.1.1-post-audit.md) | The v0.1.1 post-audit — bucket two shipped unverified | Accepted | elevated |
| [0015](0015-decision-section-plural-alias.md) | A decision section may be titled Decision or Decisions | Accepted | elevated |
| [0016](0016-bare-mention-target-skip.md) | A bare @ link target is a mention, not a dangling reference | Accepted | elevated |
| [0017](0017-clause-a-closure-and-corpus-correction.md) | Clause A closure, and the corpus correction it forced | Accepted | elevated |
| [0018](0018-the-adversarial-consolidation-round.md) | The adversarial-consolidation round, and the ambiguity class it surfaced | Accepted | elevated |
| [0019](0019-the-standing-pre-tag-adversarial-gate.md) | The standing pre-tag adversarial gate | Accepted | critical |
| [0020](0020-the-resolution-module.md) | The resolution module — one parser, one resolver ladder | Accepted | elevated |
| [0021](0021-the-full-surface-adversarial-pass.md) | The full-surface adversarial pass, and the class it closed | Accepted | elevated |
| [0022](0022-the-pre-tag-clause-a-confirmation.md) | The v0.1.5 pre-tag clause-A confirmation and corpus-roster correction | Accepted | elevated |
| [0023](0023-email-shaped-file-targets.md) | Email-shaped targets with file extensions surface as advisories | Accepted | elevated |
| [0024](0024-basename-advisories-name-all-candidates.md) | Basename advisories name every candidate, not just the first | Accepted | elevated |
| [0025](0025-the-d5-ack-source-false-positive.md) | The D5 ack-source false positive | Accepted | elevated |
| [0026](0026-clause-a-confirmation-at-v019.md) | Kill clause A — confirmation at v0.1.9 | Accepted | elevated |
| [0027](0027-never-silent.md) | A broken watch goes red on every event; no event absorbs findings silently | Accepted | elevated |
| [0028](0028-recorded-responses-and-replay-doctrine.md) | Recorded responses and the replay doctrine | Accepted | elevated |
| [0029](0029-tier1-plumbing-contract.md) | The Tier 1 plumbing contract — config surface, credential doctrine, and the deterministic relevance gate | Accepted | elevated |
| [0030](0030-parity-guard-auditable-override.md) | The parity guard gains an auditable override | Accepted | elevated |
| [0031](0031-prompt-architecture.md) | The prompt architecture — one cached prefix, structured output, citations or silence | Accepted | elevated |
| [0032](0032-tier1-input-bounds.md) | Tier 1 input bounds — a log too large to read is skipped aloud, never trimmed in silence | Accepted | elevated |
| [0033](0033-adversarial-round-citation-doctrine.md) | The adversarial round — the citation validator guarantees verbatim evidence and structural coverage, not semantic sufficiency | Accepted | elevated |
| [0034](0034-envelope-authentication.md) | Envelope authentication — a document boundary the document cannot forge | Accepted | elevated |
| [0035](0035-diff-and-decay-checks.md) | The diff-and-decay checks — S2, S3, S5, and the modes they run in | Accepted | elevated |
| [0036](0036-decay-is-a-dead-premise.md) | Decay is a dead premise, not a cited one | Accepted | elevated |
| [0037](0037-checkpointed-capture.md) | Checkpointed capture — a paid recording is written once and never re-paid | Accepted | elevated |
