---
status: accepted
date: 2026-07-18
severity: critical
---

# ADR-0046: The Tier 1 execution threat model: the scanned repo is untrusted input

## Status

Accepted, 2026-07-18. Ruled on the open PR per the retired-flip lifecycle.

## Context

Tier 1 spawns a model over repository bytes and reads artifacts from the scanned workspace: the sweep checkpoint (ADR-0045) and, ahead of the shipped calibration, a repo-local `calibration.json` override (ADR-0042, PDR §2.6.6). A cross-vendor adversarial pass, reproduced against this tree by the chat verifier, proved several of those workspace artifacts are trusted as if the tool had authored them. A committed checkpoint can suppress every finding or carry a forged one that passes citation validation; a committed `calibration.json` can open an interrupt channel the shipped artifact leaves closed, or crash the scan outright; and both the model binary and its per-send scratch directory resolve through inputs a repository can influence (the process `PATH`, the temp-directory environment).

The tool's whole premise is that a repository's claims are checked against reality. A repository that can edit the checker's own verdict breaks that premise at the root. This ADR fixes the adversary the security-hardening milestone defends against, so every later stage is measured against one named model rather than an open-ended list of cleverness.

## Decision

1. **The adversary in scope.** An actor who can land bytes on a branch that a CREDENTIALED Tier 1 run executes against: a merged contribution, a compromised dependency, or a supply-chain change to the default branch. This is NOT a fork-pull-request author. Fork pull requests do not receive repository secrets, so no Tier 1 credential is present and the semantic tier is skipped before any spawn (the credential gate, ADR-0029). The defense is measured against what this adversary can place in the workspace, nothing weaker and nothing stronger.

2. **Assets defended.** Two, and only two. Verdict truthfulness: no finding suppressed, no finding fabricated, and no interrupt decreed by anything the scanned repository supplied. Model-call integrity: the pinned model is the model that actually ran, and repository instructions never enter its context.

3. **Out of model.** An attacker holding the maintainer's CI secrets, or with write access to trusted runner state outside the scanned workspace, is a larger compromise this tool does not claim to defend against. A pipeline that already runs as the maintainer can lie in ways no in-workspace check can catch. A defense that would stop only such an attacker is not required by this milestone, and where a stage declines one on that ground it says so in its own record.

## Consequences

- Every fix in the security-hardening milestone is measured against this adversary. A defense that stops only an out-of-model attacker is out of scope, and is marked out of scope rather than half-built.
- The cross-vendor pass reproduced six concrete subversions against this tree: checkpoint suppression, checkpoint fabrication, a `PATH`-planted model binary, a scratch directory redirected under the repository, a coerced calibration override that opens a closed channel, and a malformed calibration entry that crashes the scan. Each is committed as a failing test in the Stage 0 red corpus and stays red until the stage that closes it. The reds are the specification those stages satisfy, not a to-do list that can quietly shrink.
- The specific defenses land in later stages with their own records: the sweep trusting only a checkpoint it wrote during the current run, a repo-local calibration override that may make a channel stricter but never open one, a model binary resolved from a trusted location rather than `PATH`, and a per-send scratch directory that resolves outside the scanned repository. Each is named against an asset above; none is implemented in this ADR, which fixes the frame alone.
