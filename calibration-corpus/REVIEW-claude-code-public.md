# duckadrift calibration review — generated 2026-07-18T19:13:32.090Z, corpus 211b3bd66855

10 finding(s). Replace each blank label slot with exactly `true` or `false` (case-sensitive).

## Labeling rubric (per-tuple: these labels belong to the claude-code tuple alone)

The api tuple's rubric applies verbatim (calibration-corpus/REVIEW-public.md). No api
label transfers by assumption: a byte-match machine note is a pointer for a fast tap,
never a pre-filled answer. Label format is strict: exactly `label: true` or
`label: false`, every entry, no defaults.

## finding 001
repo: cloud-platform
source: whole-log claude-code
check: S1
severity: routine
confidence: 0.85
claim: ADR 012 (Accepted) requires a single Kubernetes cluster hosting dev, staging and production workloads, partitioned only by namespace, while ADR 036 (Accepted) requires splitting workloads across multiple clusters by environment type (production vs non-production). A codebase cannot simultaneously run all environments in one cluster and run production/non-production in separate clusters.
evidence:
> After consideration of the pros and cons of each approach we went with one cluster, using namespaces to partition different workloads. — 012-One-cluster-for-dev-staging-prod.md
> start adopting multi-cluster by splitting out workloads by _environment type_, i.e. _production_ and _non-production_ — 036-multi-cluster.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 002
repo: cloud-platform
source: whole-log claude-code
check: S1
severity: routine
confidence: 0.8
claim: ADR 014 (Accepted) requires the team to self-manage the Kubernetes control plane (kOps) rather than use a managed AWS offering, while ADR 022 (Accepted) requires using the managed Amazon EKS control plane in place of kOps for the same main cluster. These are mutually exclusive control-plane management models.
evidence:
> We decided to manage the kubernetes cluster ourselves rather than using EKS mainly for the below reasons: — 014-Why-we-build-our-own-kubernetes-cluster.md
> Use Amazon EKS for running the main cluster, which hosts MOJ service teams' applications. This replaces usage of kOps. — 022-EKS.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 003
repo: cloud-platform
source: whole-log claude-code
check: S1
severity: routine
confidence: 0.6
claim: ADR 003 (Accepted) requires deployment pipelines to run on a self-hosted Concourse CI system, while ADR 040 (Accepted) requires switching deployment pipelines to GitHub Actions and decommissioning Concourse. The two records specify different, incompatible CI/CD systems as the required pipeline technology.
evidence:
> Replace self hosted Jenkins with self hosted Concourse CI pipeline — 003-Use-Concourse-CI.md
> We will switch to using GitHub Actions for our deployment pipelines. — 040-use-github-actions.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 004
repo: duckadrift
source: whole-log claude-code
check: S1
severity: elevated
confidence: 0.72
claim: ADR-0004 and ADR-0006 are both Accepted (ADR-0004 is explicitly not marked superseded) yet they impose incompatible requirements on the 'loose' ADR dialect's required sections: ADR-0004 requires that loose-dialect ADRs be checked against zero required sections, while ADR-0006 requires REQUIRED_SECTIONS.loose to be `["context", "decision"]` — the same two-section requirement as the nygard dialect. A single codebase cannot simultaneously enforce 'no sections required' and 'context and decision sections required' for the same dialect classification.
evidence:
> Loose asserts zero required sections — a genuinely freer template shouldn't be measured against Nygard's structure at all. — 0004-dialect-detection-widened.md
> `REQUIRED_SECTIONS.loose` reverts to `["context", "decision"]` — the same requirement as nygard. — 0006-loose-dialect-correction.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 005
repo: fonthead
source: whole-log claude-code
check: S1
severity: routine
confidence: 0.65
claim: ADR 0032 (Accepted) requires connect-mode font builds to ship without a GPOS kerning table (features.kerning set to false), while ADR 0039 (Accepted) requires connect-mode font builds to ship a GPOS PairPos kern table via kerning:true. Neither document's Status field marks it Superseded, Rejected, or Deprecated, so both are live decisions a single codebase cannot simultaneously satisfy: the connect build path's kerning flag cannot be both false and true.
evidence:
> Connected fonts always build non-italic, ship without a GPOS kerning table, and bypass optical sidebearing optimization — 0032-connect-sibling-of-trim-mutually-exclusive.md
> Connect mode ships a GPOS PairPos kern table via `kerning:true` and `connectKern:{}`. — 0039-connect-ships-gpos-kern-supersedes-0032.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 006
repo: duckadrift
source: whole-log claude-code
check: S4
severity: elevated
confidence: 0.5
claim: Read across the log, ADR-0018, ADR-0020, ADR-0021, ADR-0031, and ADR-0039 (five Accepted records) each circle the same underlying, never-finally-closed question: can duckadrift structurally guarantee that a primitive (link parsing, path containment, external-reference classification, number-scoping, the check pipeline, status recognition) is implemented exactly once, so a fix never fails to reach a sibling consumer? Each record explicitly declares the problem 'closed at the primitive' or 'complete,' and each subsequent record in the set instead finds the identical duplication-drift pattern recurring in a new area, undercutting the prior closure claim rather than building past it. The checker assesses this as a five-record recurring-revision chain on one unresolved architectural discrimination, not five independent, separately-resolved bugs.
evidence:
> ADR-0018 consolidated three duplicated primitives after five false positives traced to each being kept in more than one copy. — 0020-the-resolution-module.md
> The founding false positives (ADR-0018) and the scanner's leaks (ADR-0020) shared one shape — a primitive applied correctly in one place and not another — and that shape is not found by waiting for a reviewer to report an instance of it. — 0021-the-full-surface-adversarial-pass.md
> A second pipeline is the parallel-primitive failure this repository has already shipped once and now treats as a standing audit concern. — 0031-prompt-architecture.md
> Status is resolved by one shared primitive. — 0039-one-status-recognizer.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 007
repo: terraform-provider-proxmox
source: whole-log claude-code
check: S4
severity: routine
confidence: 0.42
claim: ADR-001, ADR-003, and ADR-007 each engage the same unresolved question — when the legacy SDKv2 resources under proxmoxtf/ will be fully retired and rewritten under the Plugin Framework with the new proxmox_ naming — and none of the three records closes that question. ADR-001 prioritizes VM and Container for migration but explicitly leaves SDKv2 usable 'until they are migrated'; ADR-003 documents the 'old' proxmox_virtual_environment_ naming as still-live legacy alongside the new convention; and ADR-007 explicitly defers the actual SDK-to-Framework rewrite to a future v1.0 breaking-change phase that has not landed within the record. The checker counts this as a 3-record chain that banks partial progress (naming Phase 1/2, migration priority) without resolving the underlying retirement of SDKv2 resources.
evidence:
> Bug fixes to existing SDKv2 resources (until they are migrated) — 001-use-plugin-framework.md
> `proxmox_virtual_environment_{domain}_{name}` (legacy, pre-ADR-007) — 003-resource-file-organization.md
> SDK resources (`proxmoxtf/`) are feature-frozen. As part of v1.0, each SDK resource is rewritten in the Framework provider with the new `proxmox_*` name directly. — 007-resource-type-name-migration.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 008
repo: cosmos-sdk
source: whole-log claude-code
check: S5
severity: routine
confidence: 0.78
claim: ADR-021's Decision section names the concrete file path x/bank/types/types.proto as the location of the bank module's Query service definition.
evidence:
> // x/bank/types/types.proto — adr-021-protobuf-query-encoding.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 009
repo: cosmos-sdk
source: whole-log claude-code
check: S5
severity: routine
confidence: 0.7
claim: ADR-021's Decision section names the concrete file path x/gov/types/types.proto as the location of a hypothetical gov module query service.
evidence:
> // x/gov/types/types.proto — adr-021-protobuf-query-encoding.md
machine: no byte-identical api-tuple counterpart
label: ____

## finding 010
repo: fonthead
source: whole-log claude-code
check: S5
severity: routine
confidence: 0.9
claim: ADR 0005 treats fontkit as a live dependency explicitly distrusted for validation.
evidence:
> never rely on fontkit/opentype.js to validate — 0005-font-validity-checksums-fonttools.md
machine: no byte-identical api-tuple counterpart
label: ____

