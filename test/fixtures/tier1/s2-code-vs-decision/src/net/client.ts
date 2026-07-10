// Fixture: the seeded S2 violation lives in this file.
export async function loadUpstreamStatus(url: string): Promise<number> {
  // Direct fetch call, bypassing the retry wrapper in src/net/wrapper.ts that
  // ADR-0001 requires for every outbound HTTP call in governed paths. This is
  // the code-vs-decision drift the S2 check must catch.
  const response = await fetch(url);
  return response.status;
}
