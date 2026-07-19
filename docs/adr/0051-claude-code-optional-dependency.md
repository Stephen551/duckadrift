---
status: accepted
date: 2026-07-19
severity: elevated
---

# ADR-0051: claude-code is provisioned as an optional dependency, resolved from the tool's own install

## Status

Accepted, 2026-07-19. Ruled on the open PR per the retired-flip lifecycle. Closes the provisioning follow-up ADR-0048 named but did not solve, and corrects one detail of ADR-0048's binary resolution that the package's absence at the time hid.

## Context

ADR-0048 pinned the claude binary to duckadrift's OWN install, resolved via `createRequire(import.meta.url)`, never `PATH` or cwd. It named provisioning as an unsolved follow-up: `@anthropic-ai/claude-code` was not a dependency, so a stock install found nothing at the trusted location and the subscription backend refused loudly on every run, inert.

Provisioning it also exposed a derivation ADR-0048 could not have measured, because the package was absent then. ADR-0048 derived the binary as `bin/claude.exe` on Windows and `bin/claude` on POSIX, mirroring the usual platform convention. The real package does not follow that convention: `@anthropic-ai/claude-code@2.1.138` declares its bin as `bin/claude.exe` on EVERY platform (its `files` ship `bin/claude.exe`, and its postinstall copies the per-platform native binary over that same `bin/claude.exe` placeholder), so no `bin/claude` exists on Linux. ADR-0048's POSIX guess would throw at the existence check, and the subscription backend would be broken on POSIX. This was verified by installing the package and inspecting it, and the director ruled the resolution be read from the package's own declaration.

## Decision

1. **Provision claude-code as an OPTIONAL dependency, pinned exactly to `2.1.138`.** A tight pin, not a caret range: `2.1.138` is the CLI PR B measured and the version ADR-0048's hidden `--system-prompt-file` behavior was verified against. A CLI bump revalidates that behavior by evidence before it moves. `npm ci` installs it by default, so a CLI or local install has the subscription backend provisioned; an api-only or action install omits it with `--omit=optional`.

2. **Resolve the binary from the package's own `bin.claude` field, not a hardcoded platform guess.** The resolution reads the `bin.claude` path from the resolved package.json (`bin/claude.exe`, cross-platform) and joins it to the package directory. This is correct where ADR-0048's POSIX guess was not, and self-adjusting if the package ever moves its binary. The security property is unchanged: the binary is resolved only from the tool's own trusted install (`createRequire`), never `PATH`; an install that omits the optional dependency, or a package that declares no `bin.claude`, refuses loudly here, never a silent substitution.

## Consequences

- **The action stays light.** `action.yml`'s build step runs `npm ci --omit=optional`: the Action runs the api backend, so no adopter runner carries the CLI. The subscription backend inside an action is unusual and then loud-refuses, which is correct. The api backend and Tier 0 are unaffected: neither imports nor resolves claude-code.
- **Measured (never estimated).** The optional dependency adds 245 MB to `node_modules` (`npm ci` 294 MB versus `npm ci --omit=optional` 49 MB). Install time is about 11 seconds either way with a warm npm cache; the 226 MB per-platform binary download adds time only on a cold cache.
- **The Stage 2+3 present-branch gap is closed.** Stage 2+3 could not exercise the happy-path resolution because the package was absent; the verifier endorsed that gap as unavoidable then. With the optional dependency installed, a test now asserts the trusted resolution returns the real binary's absolute path from the tool's own `node_modules`, without spawning it or making a live call. The absent-branch guard (an `--omit=optional` install refuses loudly, never `PATH`) is kept.
- The security frame of ADR-0046 and ADR-0048 holds unchanged: no repo-influenced input reaches the model call. This ADR completes the provisioning ADR-0048 deferred.
