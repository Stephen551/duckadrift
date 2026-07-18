# Quota exhaustion: documented, not observed

Status: DOCUMENTED-NOT-OBSERVED. Exhausting the account's quota was not
reachable without burning the working window, per the PR B spec's own
allowance. No live sample exists in this directory; everything below is
sourced from artifacts on this machine, not from a triggered event.

What the documentation and local sources establish:

1. The Anthropic SDK vendored in this repository (`@anthropic-ai/sdk`
   0.111.0, `core/error.d.ts` line 57) declares
   `RateLimitError extends APIError<429, Headers>`: quota and rate
   exhaustion surface as HTTP 429 at the API layer.
2. The observed auth-failure capture (`auth-failure.stdout.json`, a real
   sample in this directory) proves the headless JSON result carries the
   HTTP status of an API-layer failure in `api_error_status` (401 there)
   with `is_error: true`, `total_cost_usd: 0`, empty `modelUsage`, and the
   error text in `result`, while the process exits 1. A quota exhaustion
   is therefore expected to surface as the same envelope with
   `api_error_status: 429`.
3. Subscription-plan usage limits (as distinct from API-key rate limits)
   surface in interactive Claude Code as a usage-limit message rather than
   an API error object; the headless envelope for that case is
   unverified here and is flagged for capture the first time M5 operation
   encounters it in the wild.

M5.2's starved-world stub should therefore stub: the 401 envelope
byte-shape (observed), the 429 envelope (documented, same envelope family),
and the never-returning transport hang (observed, see
`transport-failure.meta.json`).
