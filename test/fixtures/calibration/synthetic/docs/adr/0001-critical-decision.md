---
status: accepted
date: 2026-04-01
severity: critical
---

# ADR-0001: Signing keys never leave the hardware module

## Status

Accepted — 2026-04-01

## Context

A leaked signing key forges any artifact the fleet will trust. The cost of a
false alarm against this decision is a wasted review; the cost of a missed
violation is total. That asymmetry is why this ADR is declared critical.

## Decision

Private signing keys are generated inside the HSM and never exported. Every
signature is produced by a call into the module; no code path reads the key
material into process memory.

## Consequences

Key rotation is an HSM ceremony, not a config change. A build host compromise
cannot exfiltrate a key it never holds.
