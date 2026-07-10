// Fixture stub: the retry wrapper ADR-0001 names. Only its existence and path are
// load-bearing for the fixture; the retry behavior itself is irrelevant here.
export async function fetchWithRetry(url: string): Promise<{ status: number; url: string }> {
  return { status: 200, url };
}
