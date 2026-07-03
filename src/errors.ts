/**
 * Thrown for environment/configuration problems (no ADR directory, a bad
 * --adr-dir, a missing --pr-context file) — distinct from a real Tier 0
 * finding. The CLI maps this to its own exit code so callers (the Action
 * wrapper) can tell "nothing to check yet" apart from "checked and failed":
 * a stranger's first install shouldn't see a red X before they've written
 * a single ADR (Gate G2).
 */
export class SetupError extends Error {}
