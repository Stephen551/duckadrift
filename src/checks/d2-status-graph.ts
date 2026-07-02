import { formatAdrRef } from "../adr/refs.js";
import { parseAdrRef, parseAdrRefList } from "../adr/refs.js";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
import type { Finding } from "../types.js";

/** D2: status-graph integrity — PDR §2.3. */
export function d2StatusGraphIntegrity(ctx: AdrLogContext): Finding[] {
  const findings: Finding[] = [];
  const byNumber = new Map<number, ParsedAdr>();
  for (const adr of ctx.adrs) {
    if (adr.number !== null) byNumber.set(adr.number, adr);
  }

  findings.push(...findMissingSupersededByTargets(ctx.adrs, byNumber));
  findings.push(...findSupersessionCycles(ctx.adrs, byNumber));

  const { mutual, mutualPairs } = findMutualSupersession(ctx.adrs, byNumber);
  findings.push(...mutual);
  findings.push(...findStaleSupersession(ctx.adrs, byNumber, mutualPairs));

  return findings;
}

function findMissingSupersededByTargets(
  adrs: ParsedAdr[],
  byNumber: Map<number, ParsedAdr>
): Finding[] {
  const findings: Finding[] = [];
  for (const adr of adrs) {
    const target = parseAdrRef(adr.frontmatter["superseded-by"]);
    if (target === null || byNumber.has(target)) continue;
    findings.push({
      check: "D2",
      claim: `ADR-${String(adr.number).padStart(4, "0")} declares \`superseded-by: ${String(target).padStart(4, "0")}\`, but no ADR numbered ${String(target).padStart(4, "0")} exists in the log.`,
      evidence: [{ adr: adr.fileName }],
      consequence:
        "A supersession pointer to nothing leaves the reader unable to find the decision that replaced this one — the status graph is broken at this node.",
    });
  }
  return findings;
}

function findSupersessionCycles(
  adrs: ParsedAdr[],
  byNumber: Map<number, ParsedAdr>
): Finding[] {
  const findings: Finding[] = [];
  const edges = new Map<number, number>();
  for (const adr of adrs) {
    if (adr.number === null) continue;
    const target = parseAdrRef(adr.frontmatter["superseded-by"]);
    if (target !== null && byNumber.has(target)) edges.set(adr.number, target);
  }

  const reported = new Set<number>();
  for (const start of edges.keys()) {
    if (reported.has(start)) continue;
    const path: number[] = [];
    let current: number | undefined = start;
    while (current !== undefined) {
      const loopIndex = path.indexOf(current);
      if (loopIndex !== -1) {
        const cycle = path.slice(loopIndex);
        for (const n of cycle) reported.add(n);
        findings.push({
          check: "D2",
          claim: `Supersession cycle detected: ${cycle.map((n) => formatAdrRef(n)).join(" -> ")} -> ${formatAdrRef(cycle[0]!)}.`,
          evidence: cycle.map((n) => ({ adr: byNumber.get(n)!.fileName })),
          consequence:
            "A cycle in the status graph means no ADR in the loop is the final, currently-governing decision.",
        });
        break;
      }
      path.push(current);
      current = edges.get(current);
    }
  }
  return findings;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function findMutualSupersession(
  adrs: ParsedAdr[],
  byNumber: Map<number, ParsedAdr>
): { mutual: Finding[]; mutualPairs: Set<string> } {
  const findings: Finding[] = [];
  const mutualPairs = new Set<string>();
  const reportedPairs = new Set<string>();

  for (const adr of adrs) {
    if (adr.number === null || adr.frontmatter.status !== "accepted") continue;
    for (const targetNum of parseAdrRefList(adr.frontmatter.supersedes)) {
      const target = byNumber.get(targetNum);
      if (!target || target.number === null || target.frontmatter.status !== "accepted") continue;
      if (!parseAdrRefList(target.frontmatter.supersedes).includes(adr.number)) continue;

      const key = pairKey(adr.number, target.number);
      mutualPairs.add(key);
      if (reportedPairs.has(key)) continue;
      reportedPairs.add(key);

      const [lo, hi] =
        adr.number < target.number ? [adr, target] : [target, adr];
      findings.push({
        check: "D2",
        claim: `${formatAdrRef(lo.number!)} and ${formatAdrRef(hi.number!)} are both Accepted and each claims to supersede the other.`,
        evidence: [{ adr: lo.fileName }, { adr: hi.fileName }],
        consequence: "Mutual supersession between two live decisions leaves no single decision in force.",
      });
    }
  }

  return { mutual: findings, mutualPairs };
}

function findStaleSupersession(
  adrs: ParsedAdr[],
  byNumber: Map<number, ParsedAdr>,
  mutualPairs: Set<string>
): Finding[] {
  const findings: Finding[] = [];
  for (const adr of adrs) {
    if (adr.number === null || adr.frontmatter.status !== "accepted") continue;
    for (const targetNum of parseAdrRefList(adr.frontmatter.supersedes)) {
      if (targetNum <= adr.number) continue;
      if (mutualPairs.has(pairKey(adr.number, targetNum))) continue;
      const target = byNumber.get(targetNum);
      if (!target || target.frontmatter.status !== "accepted") continue;
      findings.push({
        check: "D2",
        claim: `${formatAdrRef(adr.number)} (Accepted) claims to supersede the later ${formatAdrRef(targetNum)}, which is still Accepted.`,
        evidence: [{ adr: adr.fileName }, { adr: target.fileName }],
        consequence:
          "An earlier decision cannot supersede a later one that was never updated — one status is stale.",
      });
    }
  }
  return findings;
}
