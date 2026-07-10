---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0033: The adversarial round — the citation validator guarantees verbatim evidence and structural coverage, not semantic sufficiency

## Status

Accepted — 2026-07-10.

## Context

ADR-0031 built the semantic tier's injection resistance as four layers and named
the deterministic citation validator as the load-bearing one: even a model talked
into a fabricated finding is caught, because the finding's evidence must byte-exist
in a supplied document. An uncorrelated adversary tested that claim by attacking the
three deterministic surfaces — the validator, the prompt envelope, and the response
parser — and executed its attacks against the real code. The verifier reproduced
every reported breach and then asked the question reproduction alone does not
answer: can the production path reach it? The wire delivers a JSON response body;
the loader delivers document bytes from disk. That boundary sorts a raw breach list
into defects and artifacts.

The round confirmed the central thesis and found its real cracks. The envelope is
forgeable — an ADR body is arbitrary text and can counterfeit a delimiter — but a
forged instruction only steers the model, and the validator still discards any
finding it cannot cite verbatim. The model layer is porous by design; the validator
is the backstop, and the backstop is where the true defects were: the validator
checked that a quote exists, not that a finding carries the evidence its check
requires, and it dropped fabricated citations without counting them.

## Decision

The citation validator guarantees two things, both deterministic, and deliberately
not a third. It guarantees verbatim-ness: every surviving citation's quote byte-
exists in the specifically cited document, under one normalization (line endings)
and no other. It guarantees structural coverage: a check that asserts a relationship
among records — a contradiction between two, a recurrence across three or more —
has its citation shape enforced in code, so a finding that cites only one record
where the check requires several is discarded regardless of how the model phrased
it. It does not guarantee semantic sufficiency: whether a verbatim quote actually
supports the claim is the model's judgment, not the validator's, because a
relevance test is an uncalibrated threshold and this codebase carries no thresholds
before the calibration milestone. Coverage is countable; relevance is not; the
validator enforces only what it can count.

Every discard is counted at both granularities. A finding dropped whole is named, as
before; and now a citation dropped from within an otherwise-surviving finding is
counted too, because a fabricated citation that vanishes silently beside a real one
is the same silent drop the Pact forbids, merely one level down.

Reachability governs severity. A breach a real response or a real file can produce
is a defect and is fixed. A breach reachable only by constructing a JavaScript
object the transport can never deliver — a prototype-inherited field, a reference
cycle, a throwing getter, none of which survive a JSON round-trip — is not a
production defect; it is hardened anyway, as insurance against a future transport,
and recorded here as deliberately-not-urgent so a later audit does not re-raise it
as new.

## Consequences

- The four-layer model is unchanged in intent and stronger in fact: the porous
  layers (system doctrine, envelope) degrade to the backstop, and the backstop was
  hardened where it leaked. Envelope authentication is worth doing as defense in
  depth and is scoped as its own follow-up, not as a backstop fix.
- Structural coverage is a per-check property: each semantic check declares the
  minimum distinct-document citation count its finding shape requires, and the one
  validator enforces every check's declaration — one primitive, not per-check
  copies.
- The adversary's full attack set becomes a permanent regression corpus behind the
  recorded-response and unit gates, so no future prompt or parser change silently
  re-opens a closed breach — the standing rule that a committed guard nothing runs
  is rot, applied to security.
- The round's honesty is on the record both ways: the adversary declared it truly
  executed, and the verifier separated the defects it found from the artifacts its
  in-process harness reached past. Neither claim was taken on attestation.
