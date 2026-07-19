---
status: accepted
date: 2026-07-19
severity: elevated
---

# ADR-0050: The deadline kill covers the whole process tree, and a kill it cannot confirm is loud

## Status

Accepted, 2026-07-19. Ruled on the open PR per the retired-flip lifecycle. Extends ADR-0044 decision 2 (the transport owns the deadline); it does not change that decision. This ADR closes the security-hardening milestone.

## Context

ADR-0044 gave the transport an owned deadline: the claude CLI is proven never to self-terminate under transport denial (PR B measured a full 120-second retry window), so waiting on it is a dormancy violation, and on expiry the transport kills the process and surfaces a terminal error. Two cross-vendor reviewers found the kill did not fully honor that ownership.

On POSIX the deadline did `child.kill("SIGKILL")`, which signals only the direct child. SIGKILL is not propagated to a process's own children, so a claude binary that spawns a subprocess leaves that subprocess orphaned and running past the deadline. The transport claims the process is dead; a grandchild survives it.

On Windows the deadline spawned `taskkill /T /F` (already a tree kill) fire-and-forget and never awaited its result. A taskkill that fails to run, or exits non-zero, is indistinguishable from a successful kill: the transport assumes the tree died and surfaces the deadline error regardless. A kill whose success was never confirmed is a silent assumption, which the never-silent doctrine forbids.

Two other riders carried into this milestone were mooted by an earlier stage, verified and struck here: the `keyOf` `"|"`-join collision and the `treeIdentity` U+FFFD note both lived in `src/tier1/sweep.ts`, which ADR-0047 (Stage 1) deleted in full. Recordings are located by path and matched on the sha256 `promptHash`, with no unescaped-join key, so no collision surface remains. Neither is reintroduced.

## Decision

1. **POSIX: kill the process group, not the process.** The child is spawned detached, so it leads its own process group; on deadline expiry the transport sends `SIGKILL` to the whole group (`process.kill(-pid, "SIGKILL")`). Nothing the CLI started survives the deadline. `ESRCH` (the group already exited) is a confirmed kill, not a failure: nothing survives.

2. **Windows: await the tree kill, and surface a kill it cannot confirm.** `taskkill /T /F` is awaited. If it fails to run or exits non-zero, the deadline error names the unconfirmed kill rather than asserting the tree died. A kill the transport cannot confirm is reported loudly, never silently trusted.

3. **The kill logic is one testable unit.** `killProcessTree` returns undefined on a confirmed kill or a reason string when the kill could not be confirmed; the deadline handler builds the terminal transport error from that result. The Windows await-and-surface path is exercised deterministically by injecting the platform and a stubbed tree-killer, so it is proven on any runner, not only Windows.

## Consequences

- The detached spawn changes the child's process-group membership on POSIX. It must not, and does not, change stdin prompt delivery or stdout collection: all of the transport's prior scenario tests pass unchanged, and a new POSIX test proves a grandchild the fake CLI spawns is dead after the deadline (red against the old direct-child kill, green under the group kill).
- The Windows live taskkill invocation is proven by the same standard as the live claude path (ADR-0044): code plus the deterministic unit test of the await-and-surface logic, not a Windows CI run, which the Linux runner cannot provide. The ledger states this coverage boundary explicitly.
- This ADR closes the security-hardening milestone. The red corpus is empty (ADR-0046 through 0049), and the two mooted riders are struck. What remains for the tool is milestone work outside security hardening.
