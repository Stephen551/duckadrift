import { formatAdrRef } from "../adr/refs.js";
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
      claim: `${formatAdrRef(adr.number)} is Accepted with \`review-by: ${reviewBy}\`, which has passed.`,
      evidence: [{ adr: adr.fileName }],
      consequence:
        "An expired review-by date means the team asked to be reminded to re-examine this decision, and nobody has.",
    });
  }
  return findings;
}
