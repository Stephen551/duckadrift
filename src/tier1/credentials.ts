/**
 * True when ANTHROPIC_API_KEY is present and non-empty in the environment. The
 * value itself never leaves process.env — not into config, reports, logs, or
 * errors (PDR §2.8: env only). Presence is the only fact the rest of the
 * system is allowed to know; this boolean is the entire credential surface.
 */
export function tier1CredentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.ANTHROPIC_API_KEY;
  // Trimmed: a whitespace-only key is absent (PR #32's logged non-blocker,
  // landed here on schedule with M3.2).
  return key !== undefined && key.trim() !== "";
}

/**
 * True when CLAUDE_CODE_OAUTH_TOKEN is present and non-empty: the claude-code
 * backend's credential, same quarantine doctrine as the API key (ADR-0029
 * extended by ADR-0044). This module knows only env-var presence; WHICH
 * backend needs WHICH credential is the transport module's map, the one place
 * a backend conditional is permitted.
 */
export function claudeCodeCredentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN;
  return token !== undefined && token.trim() !== "";
}
