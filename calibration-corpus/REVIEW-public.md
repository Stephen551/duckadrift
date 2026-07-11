# duckadrift calibration review — generated 2026-07-11T16:40:50.533Z, corpus 76c0015e060b

10 finding(s). Replace each blank label slot with exactly `true` or `false` (case-sensitive).

## Labeling rubric (read before labeling; the labels are the moat)

- **S1 (contradiction):** TRUE if the two cited records, read as written, genuinely commit
  to incompatible things a maintainer would have to reconcile. Not a contradiction:
  scope-split decisions, one record refining another, or rhetorical tension.
- **S4 (recurring revision):** TRUE if the cited records revisit the same underlying
  decision (same subject circling) such that a maintainer should consolidate or supersede.
  Not recurring: a sequence that is genuine forward evolution with each step superseding
  cleanly.
- **S5 (dead premise, private side only):** TRUE if the premise the finding quotes is, in
  YOUR tree today, genuinely gone (the named dependency absent from every manifest, the
  path absent from disk). You are the final audit on the deterministic confirmation —
  check the tree, not your recollection.
- **S3 (unrecorded decision):** TRUE if the changed manifest/schema content the finding
  cites embodies an architectural decision (a new dependency direction, a storage shape,
  a framework commitment) that a decision-record-keeping team should have recorded at
  that commit — judged at that commit, not with hindsight. FALSE for routine version
  bumps, lockfile churn, or mechanical renames.

Label format is strict: exactly `label: true` or `label: false`, every entry, no
defaults. The parser refuses anything else — that refusal is the corpus's integrity,
not an inconvenience.

## finding 001
repo: backstage
source: diff 29397654e29a
check: S3
severity: routine
confidence: 0.55
claim: The root package.json adds a resolutions entry that remaps the package name 'GendocuPublicApis' to an npm package 'gendocu-public-apis', an unusual dependency substitution with no apparent connection to the rest of the resolutions block (which otherwise contains patch overrides for existing packages), and no decision record explains why this resolution exists.
evidence:
> "GendocuPublicApis": "npm:gendocu-public-apis@^1.0.0", — package.json
label: false

## finding 002
repo: cloud-platform
source: whole-log
check: S1
severity: routine
confidence: 0.35
claim: ADR 012 (One cluster for dev/staging/prod) requires a single Kubernetes cluster hosting all workload types with namespace-based partitioning, while ADR 036 (Multi-cluster) and ADR 048 (Per Business Unit Clusters) require splitting workloads across multiple separate clusters by environment type and business unit. Both records are marked Accepted, and their core infrastructure requirements (one cluster vs many clusters) are mutually exclusive for the same codebase/platform at the same time.
evidence:
> After consideration of the pros and cons of each approach we went with one cluster, using namespaces to partition different workloads. — 012-One-cluster-for-dev-staging-prod.md
> We will give a non-live and a live cluster for each business unit. — 048-per-business-unit-clusters.md
label: true

## finding 003
repo: cloud-platform
source: whole-log
check: S4
severity: routine
confidence: 0.55
claim: The decision of how many Kubernetes clusters to run and how to segment them (single cluster vs multi-cluster vs per-business-unit) is a recurring, unresolved primitive spanning at least four Accepted ADRs: 012 (one cluster for dev/staging/prod), 036 (multi-cluster split by environment type), 042 (multi-cluster tied to Modernisation Platform accounts), and 048 (per-business-unit clusters), each parking or narrowing cluster topology rather than settling it permanently, with 012 itself later annotated as being revisited and 048 explicitly reframing 036's decision as insufficient.
evidence:
> **May 2021 Update** We're looking to move on from this ADR decision, and have different clusters for non-prod namespaces - see [021-Multi-cluster] — 012-One-cluster-for-dev-staging-prod.md
> start adopting multi-cluster by splitting out workloads by _environment type_, i.e. _production_ and _non-production_ — 036-multi-cluster.md
> We will use an AWS account per live and non-live clusters (as per ADR 36 Multi Cluster decision). — 042-use-modernisation-platform-accounts.md
> Decision 036 reduces the blast radius with non live and live clusters, but this still leaves the noisy neighbour problem and potential security threats traversing business units. — 048-per-business-unit-clusters.md
label: true

## finding 004
repo: cloud-platform
source: diff 07d3f0ff3e29
check: S3
severity: routine
confidence: 0.55
claim: The go.mod adds direct dependencies on GitHub API client and OAuth2 libraries (go-github/v68, go-githubauth, x/oauth2), and additionally pulls in a second, different major version of go-github (v69) as an indirect dependency, which constitutes an architectural choice (which GitHub client library and auth mechanism to use for issue creation) with no accompanying decision record.
evidence:
> require ( 	github.com/google/go-github/v68 v68.0.0 	github.com/jferrl/go-githubauth v1.2.0 	golang.org/x/oauth2 v0.28.0 ) — cmd/create-upgrade-issues/go.mod
> github.com/google/go-github/v69 v69.0.0 // indirect — cmd/create-upgrade-issues/go.mod
label: false

## finding 005
repo: cosmos-sdk
source: diff a45437c55b4c
check: S3
severity: routine
confidence: 0.55
claim: The new enterprise/poa and enterprise/group modules (a new proof-of-authority module and a group module split into an enterprise directory) are introduced as new Go modules with dependencies on the core SDK, cometbft, and store/v2, without an accompanying decision record explaining why these were split out as standalone enterprise modules with their own module boundaries.
evidence:
> module github.com/cosmos/cosmos-sdk/enterprise/poa — enterprise/poa/go.mod
> module github.com/cosmos/cosmos-sdk/enterprise/group — enterprise/group/go.mod
label: false

## finding 006
repo: cosmos-sdk
source: diff a45437c55b4c
check: S3
severity: routine
confidence: 0.3
claim: The store/v2 module adds a dependency on github.com/hashicorp/go-plugin, a library for building plugin-based process architectures, which is an architectural choice (out-of-process plugin boundary) that a later reader would need reasoning for.
evidence:
> github.com/hashicorp/go-plugin v1.8.0 — store/go.mod
label: false

## finding 007
repo: duckadrift
source: whole-log
check: S4
severity: elevated
confidence: 0.35
claim: ADR-0009, ADR-0010, and ADR-0011 form a recurring-revision set (three records) that each apply the same 'provable state vs. provable error' fact/advisory downgrade doctrine (first established in ADR-0005/ADR-0008) to a different Tier 0 check, without any of them settling the underlying open question of when a fact-tier claim should be downgraded — each narrows the doctrine to its own case (annex numbering, numbering gaps, site-relative links) rather than resolving it generally, and ADR-0008 explicitly leaves related sub-questions (doctrine Q1, Q2) open.
evidence:
> ADR-0008 already established that a same-directory collision stays fact-tier by default — this is the one recognized exception to that: a shared base filename plus a well-known annex or companion suffix is a real, common convention for splitting one decision across multiple documents, not an authoring accident. — 0009-annex-companion-numbering.md
> A gap is a provable *state*, not a provable *error*. — 0010-numbering-gaps-advisory.md
> This is a provable-state, not provable-error, distinction, the same shape as ADR-0009 and ADR-0010: the tool can prove the file exists somewhere; it cannot prove the specific link is wrong for this repo's publishing setup. — 0011-site-relative-dangles-advisory.md
label: false

## finding 008
repo: duckadrift
source: whole-log
check: S4
severity: elevated
confidence: 0.15
claim: The parallel-primitive duplication failure (a hardening applied to one copy of a shared mechanism failing to reach its sibling copies) recurs across ADR-0018, ADR-0020, and ADR-0021 as three separate consolidation efforts, each claiming to close the class but each followed by another instance being found, suggesting the underlying architectural problem (multiple implementations of what should be one primitive) was never fully resolved until explicitly claimed complete in ADR-0021.
evidence:
> The five were not five bugs. They were three primitives kept in duplicate — link parsing, number-scoping, and path containment — where hardening applied to one copy never reached its siblings. — 0018-the-adversarial-consolidation-round.md
> ADR-0018 consolidated three duplicated primitives after five false positives traced to each being kept in more than one copy. Link parsing was one of them, and the consolidation gave it a single home: a hand-rolled scanner every check shared. That fixed the duplication and left a deeper problem standing — 0020-the-resolution-module.md
> The result confirmed the thesis by finding the signature bug five more times. Path containment excluded the ADR directory by string prefix, so a sibling directory named `docs/adr-extra` slipped the exclusion. — 0021-the-full-surface-adversarial-pass.md
label: false

## finding 009
repo: fonthead
source: diff 38befecbe7af
check: S3
severity: routine
confidence: 0.7
claim: The project adopts better-auth as an authentication dependency and pins kysely to an exact version via a package.json override, without any accompanying decision record explaining the choice of auth library or the reason for forcing a specific kysely version.
evidence:
> "better-auth": "^1.5.0", — package.json
> "overrides": {     "kysely": "0.28.17"   }, — package.json
label: false

## finding 010
repo: terraform-provider-proxmox
source: diff 804860f6252a
check: S3
severity: routine
confidence: 0.35
claim: go.mod adds a new direct dependency on github.com/go-git/go-git/v5 (via go.sum entries), which introduces a full git implementation into the provider — a significant new capability that would need an explanation of why the provider now needs to perform git operations.
evidence:
> github.com/go-git/go-git/v5 v5.18.0 h1:O831KI+0PR51hM2kep6T8k+w0/LIAD490gvqMCvL5hM= — go.sum
label: false

