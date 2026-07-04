import { formatAdrRef } from "../adr/refs.js";
import { code } from "../report/write.js";
import type { AdrLogContext } from "../adr/types.js";
import type { Finding } from "../types.js";

/** D6: staleness clock — PDR §2.3. `now` is injectable for deterministic tests. */
export function d6StalenessClock(ctx: AdrLogContext, now: Date = new Date()): Finding[] {
  const findings: Finding[] = [];
  for (const adr of ctx.adrs) {
    if (adr.number === null || adr.frontmatter.status !== "accepted") continue;
    const reviewBy = adr.frontmatter["review-by"];
    if (!reviewBy) continue;

    const reviewDate = new Date(reviewBy);
    if (Number.isNaN(reviewDate.getTime()) || reviewDate.getTime() >= now.getTime()) continue;

    findings.push({
      check: "D6",
      // review-by is attacker-authorable and reaches the report verbatim; a
      // value V8's date parser accepts can still carry backticks in a trailing
      // parenthesized comment. Fence it through code() so it can't break out
      // and inject live markdown (S3 post-audit, ADR-0013) — the same class as
      // D2's dirLabel and D3's link target.
      claim: `${formatAdrRef(adr.number)} is Accepted with ${code(`review-by: ${reviewBy}`)}, which has passed.`,
      evidence: [{ adr: adr.fileName }],
      consequence:
        "An expired review-by date means the team asked to be reminded to re-examine this decision, and nobody has.",
    });
  }
  return findings;
}
