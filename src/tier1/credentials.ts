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
