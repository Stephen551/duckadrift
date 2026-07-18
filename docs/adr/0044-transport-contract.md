---
status: proposed
date: 2026-07-17
severity: elevated
---

# ADR-0044: The transport contract: one seam, owned deadlines, hermetic spawns

## Status

Proposed, 2026-07-17. The director flips this to Accepted on the merge ruling.

## Context

M5 adds a second Tier 1 backend (claude-code, subscription). One engine is ratified law (PDR 2.8); the backends may differ only at the transport seam. The PR B spike measured the facts this contract rests on: the headless CLI emits a schema-stable 17-key JSON envelope; modelUsage proves which model ran; auth failure arrives as a 401 inside the same envelope at cost 0; under total network denial the CLI retries for the entire 120-second window and never surfaces a terminal error; without `--strict-mcp-config` a headless run loads user-scope MCP config (60,442 cache-creation tokens, $0.3782 on a one-word prompt); Windows shell-spawn requires pre-quoted args or silently swallows the prompt.

## Decision

1. One interface, both backends: assembled prompt in; raw response plus usage out. Nothing else crosses the seam. Runner, prompt assembly, citation validation, and routing are transport-blind. A conditional on backend anywhere outside the transport module is a rejected pattern.
2. The transport owns the deadline. Every call runs under a hard timeout; on expiry the transport kills the process and surfaces a terminal transport error loudly. The CLI is proven not to self-terminate; waiting on it is a dormancy violation.
3. Hermetic spawn invariants for the claude-code transport: minimal allowlisted env; the metered API key is excluded so auth resolves to the subscription login; `--strict-mcp-config` always; args pre-quoted.
4. Model pinning is verified, not trusted: the transport checks that modelUsage names exactly the pinned model and refuses the response otherwise. Runtime model default remains claude-sonnet-5; fable is never a runtime model (director ruling, 2026-07-17).
5. Error taxonomy: auth (envelope api_error_status, cost 0), quota (documented shape until observed live; upgraded when M5.3 observes one), transport (deadline kill, network fault, malformed envelope). Each class is distinct in the transport's result type; no class is ever silent.
6. Recording keys carry the backend dimension. The key tuple remains {backend, model, effort, checkId, promptHash} exactly as shipped in M3 (ADR-0028), where backend was the single literal "api"; this contract widens it to the closed set "api" | "claude-code", and the recording filename gains the backend segment so two backends' recordings of the same check can never collide in one directory. Existing api recordings rekey by rename only, bytes untouched.

## Consequences

- The api transport sits behind the seam with the recorded corpus replaying byte-identically across the refactor (the PR C gate).
- The deadline default is chosen and justified when the live claude-code transport lands (M5.1), from the measured 120-second evidence, as config with a sane default, never a hand-typed constant in check code.
- The CLI's telemetry endpoint (observed: Datadog intake) is recorded as a docs disclosure item for the Solo preset, not an engineering change.
