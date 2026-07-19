---
status: accepted
date: 2026-07-18
severity: critical
---

# ADR-0048: The transport resolves its binary and its scratch from tool-trusted locations, never repo-influenced inputs

## Status

Accepted, 2026-07-18. Ruled on the open PR per the retired-flip lifecycle. Extends ADR-0044's hermetic-spawn invariants; applies ADR-0046's threat model to two more inputs.

## Context

ADR-0044 set the hermetic-spawn invariants for the claude-code transport; ADR-0046 fixed that the scanned repo is untrusted input. Two inputs to the model call still resolve through channels the scanned repo can influence, and Stage 0's red corpus reproduced both against this tree.

The binary: `execFile("claude")` resolves the CLI through `PATH`. A scanned repo that prepends a directory to `PATH` (a workflow step writing `$GITHUB_PATH` on the default branch is in scope) plants a fake `claude` that runs and returns forged findings (red 3). The scratch directory: the per-send scratch is `mkdtempSync` over `tmpdir()`, which honors `TMPDIR`/`TEMP`/`TMP`. A repo that sets the temp env to a path under its own root lands the scratch inside the scanned repo, and the repo's own `CLAUDE.md` re-enters the model's context through the child's working directory (red 4).

## Decision

One principle, ADR-0046's "the scanned repo is untrusted input", applied to two inputs.

1. **The binary is resolved from the tool's own install, never `PATH`.** duckadrift's own `node_modules` is the one location the scanned repo's bytes cannot write, so the transport resolves the claude binary there and spawns that absolute path. `PATH` is never consulted for resolution. If the binary is absent from the trusted location, the run surfaces a loud transport error; there is no fall-through to a `PATH` lookup. A single injectable seam (`claudeBinaryPath` on the transport) lets the deterministic harness supply its fake CLI; production takes the trusted resolution. The seam is the only way a test provides a binary, so no test resolves through `PATH`.

2. **The scratch is anchored outside the scanned repo.** The scratch base is resolved to an absolute path and asserted outside `repoRoot`. Because `tmpdir()` honors the repo-settable temp env, a redirect that would place the scratch under the scanned repo is refused loudly rather than proceeded with, isolation defeated. `repoRoot` reaches the transport for this assertion; one engine holds, the api transport ignores it.

## The provisioning follow-up (named, not solved here)

`@anthropic-ai/claude-code` is not currently a duckadrift dependency, so in a stock install the trusted resolution finds nothing and the subscription backend refuses loudly on every run. This ADR fixes the RESOLUTION (never `PATH`, trusted location or loud refuse); it does not decide PROVISIONING, whether that is bundling claude-code into the tool's install or a Team-preset install step. Provisioning is a follow-up with its own record. The security property this ADR buys holds either way: no repo-influenced input reaches the model call.

## Consequences

- The M5 `PATH`-based resolution is removed. The subscription backend now requires the claude binary in the tool's trusted location and refuses loudly otherwise, never a silent `PATH` substitution. That refusal is honest (the Pact); the backend does not quietly run the wrong binary.
- `repoRoot` is threaded to the transport through `liveTransportFor` and its callers (report, capture). It carries no behavior for the api backend.
- Every claude-code transport test moves to the injectable binary seam. A test that still passed only because `PATH` resolution lingered would be a false green, so none is left on `PATH`. Reds 3 and 4 move from the red corpus into the transport test as passing guards; the red corpus drops to the two calibration attacks.
- The change is bounded to the transport seam and its callers (ADR-0044's rule: no backend conditional outside the transport module).
