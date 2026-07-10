---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0029: The Tier 1 plumbing contract — config surface, credential doctrine, and the deterministic relevance gate

## Status

Accepted — 2026-07-10.

## Context

The semantic tier needs three deterministic things before any prompt exists: a
declared configuration surface, a credential posture, and the relevance gate
ADR-0003 ratified — the decision about when Tier 1 is even allowed to spend. All
three are testable at Tier 0 grade today, and building them before the check
pipeline keeps the pipeline honest: the gate's contract cannot quietly bend to fit
what the checks turn out to want.

## Decision

The config surface is `tier1.enabled` (default false), `tier1.backend` (default
`api`, the only value this build accepts — `claude-code` is refused loudly by name
until M5), `tier1.model` (default `claude-sonnet-5`), and `tier1.effort` (default
`high`). Model and effort are not cosmetic: they are two-fifths of the recording key
(ADR-0028) and the calibration key (PDR §2.6), so their defaults are the tuple the
shipped calibration will be measured against.

Credentials are `ANTHROPIC_API_KEY` from the environment only. The system may know
that the key is present; no component may know what it is — the value never enters
configuration objects, reports, logs, or error messages.

The relevance gate is deterministic and PR-mode only. It signals on: a changed file
under an Accepted ADR's `governs:` glob, matched by the same shared primitive D5
uses — extracted, not copied, because parallel copies of one primitive is the drift
class this tool exists to catch and once shipped inside it; a changed dependency
manifest, by exact basename against a named list; or a changed storage artifact, by
`.sql` extension, a `schema`/`migrations`-class path segment, or a `schema.*`
basename. The gate takes no acknowledgement exemption: a PR that touches a governed
path and its ADR together is precisely a PR the semantic tier should read.

The third ADR-0003 signal — a cross-module boundary move — is deferred, declared
here rather than shipped as a guess: name-only diff contexts represent renames as
delete-add pairs, and inferring a move from basename pairing is a heuristic. A
guessed signal has no place in a deterministic gate. It lands when the PR context
carries rename metadata.

Skipping is always spoken. A no-signal PR reports "skipped: no signal" with zero API
calls; a credential-less run reports Tier 0-only coverage and names the fork-PR case
where that absence is expected. The gate opens spending, never verdicts, so its
named sets may be generous: a false signal costs one gated eligibility, while a
missed signal is still surfaced as the no-signal status — never silently absorbed.

## Consequences

- `.duckadrift.yml`'s absence remains the common case: every `tier1` key has a
  working default, and the defaults are the calibration tuple.
- A typo inside the `tier1:` block is named on stderr instead of silently meaning
  "the watch is down" — the dormancy shape a quietly ignored `enable:` would create.
- D5 and the gate share one governed-path matcher; a future hardening of that
  primitive reaches both consumers by construction.
- The report's Tier 1 block now states one of: disabled, skipped for credentials,
  skipped for no signal, or eligible — and "eligible" says plainly that no semantic
  checks exist yet. The status vocabulary is the contract M3.2's pipeline plugs
  into.
