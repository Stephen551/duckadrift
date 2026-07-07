---
status: accepted
date: 2026-07-05
severity: critical
---

# ADR-0019: The standing pre-tag adversarial gate

## Status

Accepted — 2026-07-05.

## Context

A tag is irreversible in the way that matters here: once `v0` floats to a version and
that version is on the Marketplace, an outside repository can pin it, and a false positive
in that version fails a stranger's build with the tool's own authority. Every release so
far has had an adversarial pass before it — but by choice each time, not by rule, and the
rulings ledger has carried the question of whether to make it standing since M2.

Three cycles are the evidence for making it standing. The v0.1.0 audit (ADR-0013) and the
v0.1.1 post-audit (ADR-0014) each caught real defects that would otherwise have shipped.
The adversarial-consolidation round (ADR-0018) caught three more before the publish: a
quadratic parser path reachable from fork content, and two `X (suffix)` hard-fails — one of
them, the site-relative regression, invisible to the corpus differential and surfaced only
by an uncorrelated external reviewer. That last finding is the specific reason a clean
differential can no longer be trusted to clear a tag on its own: the differential sees only
the shapes the corpus happens to contain, and the corpus cannot contain every shape an
attacker can write.

Two gaps in the ad-hoc practice also showed themselves. The corpus confirmation that kill
clause A requires has been running *after* the publish, inside the fourteen-day window —
which means a surviving false positive would be triaged against a live listing and a clock.
And "byte-identical to the prior release" was being read as "clean at this release," which
is the reasoning that let the site-relative regression through. Both are ordering and
sufficiency errors, not effort errors; the fix is a rule, not more work.

## Decision

1. **No tag is cut without the adversarial pass clearing.** The pass is standing, not
   discretionary, and it runs before the tag and before any publish — never after. The `v0`
   float is not a separately gated event: it inherits the gate from the versioned tag it
   points to.

2. **The pass is tiered to what changed, and the verifier proposes the tier from the diff
   for the director to ratify.** When the tier is uncertain, it escalates — over-testing a
   tag costs minutes, under-testing an irreversible public tag costs the trust the tool
   sells.

   - **Tier D — records only.** ADRs, README, CHANGELOG, comments; no change to checked
     behavior. The gate is a records-only footprint confirmed against the diff and a clean
     `check .` self-scan. No probe, no vendors — nothing an outside repository runs has
     changed.
   - **Tier B — behavioral.** A source change that alters a check or the engine, adds no new
     check, and does not touch link parsing, path containment, reference resolution, the
     report or annotation surface, or any attacker-reachable path. The gate is Tier D, plus
     the verifier's own fresh probe of the changed surface, plus the full corpus differential
     run *at the tagged commit*, plus confirmed red-before on every fix. External vendors are
     the director's option at this tier.
   - **Tier A — core, security, or new check.** Any change to link parsing, path containment,
     reference resolution, the report or annotation surface, an attacker-reachable code path,
     or the introduction of a new check. The gate is Tier B, plus a full uncorrelated
     cross-vendor round — one reviewer in a red-team framing, one in an audit framing, run in
     separate sessions on the changed surface — with every finding reproduced independently
     and triaged as regression or pre-existing before it counts.

3. **A clean differential never clears Tier B or A on its own.** The differential catches
   regressions on the shapes real repositories carry; it is blind to the shapes they do not.
   It is paired with adversarial probing of the changed surface, always — the site-relative
   regression passed the differential and was caught only by a reviewer who wrote a shape the
   corpus lacked.

4. **The corpus confirmation moves before the tag.** The full corpus pass — the internal
   logs and the external R5 repositories — runs at the tagged commit, before publish. Kill
   clause A's post-publish window becomes a re-confirmation of a result already established,
   not the first time the corpus meets the shipping code.

5. **A gate finding is resolved on the pre-tag branch, or recorded before the tag — never
   carried silently.** A finding folds into the branch and is re-verified before the tag is
   cut. A finding deliberately deferred is written to the log first, with its rationale and
   its severity, the way ADR-0018 recorded its three deferrals. Silence is the one outcome
   the gate does not permit — the Pact applied to the release process itself.

## Consequences

- Every future tag carries a named tier and a cleared gate on the record. The floor is real
  for even a records tag (footprint plus self-scan); the ceiling is the full cross-vendor
  round for anything that touches the surface an attacker controls.
- The differential keeps its place as necessary and loses its false standing as sufficient.
  The pairing with adversarial probing is now doctrine, not a habit that happened to hold.
- The clause-A corpus run is pulled out from under its own clock. A surviving false positive
  is found before a listing exists to be embarrassed by it, not after — the difference
  between fixing a branch and triaging in public.
- This does not settle the other open ledger question — whether S0 and S2 should push-block
  on non-PR events. That remains open and is not decided here.
- The gate is the ADR-0013 and ADR-0014 practice made standing, and the reason it is worth a
  critical-severity rule rather than a convention is the asymmetry it guards: the cost of the
  gate is measured in minutes per tag, and the cost of the failure it prevents is measured in
  the trust that a Tier 0 finding is a fact — the one thing the tool has to sell.
