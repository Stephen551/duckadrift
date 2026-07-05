import { formatAdrRef, padAdrNumber } from "../adr/refs.js";
import { parseAdrRef, parseAdrRefList } from "../adr/refs.js";
import { code } from "../report/write.js";
import type { AdrLogContext, NumberingScope, ParsedAdr } from "../adr/types.js";
import type { Finding } from "../types.js";

/** The directory an ADR lives in, relative to the ADR root ("" for a root-level ADR). */
function dirOf(fileName: string): string {
  const i = fileName.lastIndexOf("/");
  return i === -1 ? "" : fileName.slice(0, i);
}

// The directory name is attacker-authorable — a fork can name an ADR
// subdirectory anything the filesystem allows, backticks included. Fence it
// through code() so a backtick can't close the span and inject live markdown
// into the report (S3 post-audit, ADR-0013). D1's directoryLabel already does
// this; the hand-rolled single-backtick span here was the sibling that missed.
function dirLabel(dir: string): string {
  return dir === "" ? "the ADR root" : code(`${dir}/`);
}

/**
 * Resolves a bare ADR number the way ADR-0008's numbering namespace says it
 * should (C2, ADR-0013). Under the default per-directory scope, a bare number
 * in `supersedes`/`superseded-by` means "the ADR with that number in *my own*
 * directory" — not whichever ADR happens to hold that number somewhere else in
 * the log. Before C2, every supersession check resolved against a single
 * global number map, so a per-team ADR that superseded its own directory-local
 * predecessor was accused of superseding an unrelated, identically-numbered
 * ADR in a sibling directory — while D1, in the same run, correctly treated
 * that number as directory-scoped. Under an explicit `numbering: global`, the
 * whole-log map is the right one and is used unchanged.
 */
function makeResolver(
  adrs: ParsedAdr[],
  scope: NumberingScope
): { resolve: (from: ParsedAdr, num: number) => ParsedAdr | null; byNumber: Map<number, ParsedAdr> } {
  const byNumber = new Map<number, ParsedAdr>();
  const byDirNumber = new Map<string, Map<number, ParsedAdr>>();
  for (const adr of adrs) {
    if (adr.number === null) continue;
    if (!byNumber.has(adr.number)) byNumber.set(adr.number, adr);
    const dir = dirOf(adr.fileName);
    let m = byDirNumber.get(dir);
    if (!m) {
      m = new Map();
      byDirNumber.set(dir, m);
    }
    if (!m.has(adr.number)) m.set(adr.number, adr);
  }
  const resolve = (from: ParsedAdr, num: number): ParsedAdr | null => {
    if (scope === "global") return byNumber.get(num) ?? null;
    return byDirNumber.get(dirOf(from.fileName))?.get(num) ?? null;
  };
  return { resolve, byNumber };
}

/** D2: status-graph integrity — PDR §2.3. */
export function d2StatusGraphIntegrity(ctx: AdrLogContext): Finding[] {
  const findings: Finding[] = [];
  const { resolve, byNumber } = makeResolver(ctx.adrs, ctx.numberingScope);

  findings.push(...findUnresolvedBareRefs(ctx.adrs, ctx.numberingScope, resolve, byNumber));
  findings.push(...findMissingSupersededByTargets(ctx.adrs, byNumber));
  findings.push(...findSupersessionCycles(ctx.adrs, resolve));

  const { mutual, mutualPairs } = findMutualSupersession(ctx.adrs, resolve);
  findings.push(...mutual);
  findings.push(...findStaleSupersession(ctx.adrs, resolve, mutualPairs));

  return findings;
}

/**
 * C2 (ADR-0013): a bare `supersedes`/`superseded-by` number that doesn't
 * resolve in its own directory is surfaced, never silently dropped. Two cases:
 *
 * - The number exists in *another* directory: a loud advisory naming both
 *   directories — never resolved to that other directory's ADR as a fact-tier
 *   accusation (the launch-headline false positive).
 * - The number exists *nowhere* in the log: a dangling pointer. A dangling
 *   `superseded-by` is already fact-flagged by findMissingSupersededByTargets;
 *   a dangling `supersedes` was a silent no-op before this — now a loud
 *   advisory. Silent-dropping a broken pointer in the release whose thesis is
 *   "never silently drop" is the one hypocrisy this can't ship.
 *
 * Cross-directory resolution is only meaningful under per-directory scope; a
 * `numbering: global` log resolves a bare number log-wide by definition, so
 * only the dangling-nowhere case applies there.
 */
function findUnresolvedBareRefs(
  adrs: ParsedAdr[],
  scope: NumberingScope,
  resolve: (from: ParsedAdr, num: number) => ParsedAdr | null,
  byNumber: Map<number, ParsedAdr>
): Finding[] {
  const findings: Finding[] = [];
  for (const adr of adrs) {
    if (adr.number === null) continue;
    const refs: { kind: string; num: number }[] = [];
    const sb = parseAdrRef(adr.frontmatter["superseded-by"]);
    if (sb !== null) refs.push({ kind: "superseded-by", num: sb });
    for (const n of parseAdrRefList(adr.frontmatter.supersedes)) refs.push({ kind: "supersedes", num: n });

    for (const { kind, num } of refs) {
      if (resolve(adr, num) !== null) continue; // resolves in its own directory — fine
      const elsewhere = byNumber.get(num);
      if (elsewhere) {
        // Exists in another directory only. Under global scope resolve() would
        // have found it, so this branch is per-directory-scope by construction.
        findings.push({
          check: "D2",
          claim: `${formatAdrRef(adr.number)} declares \`${kind}: ${padAdrNumber(num)}\`, but no ${formatAdrRef(num)} exists in its own directory (${dirLabel(dirOf(adr.fileName))}); a same-numbered ADR exists in ${dirLabel(dirOf(elsewhere.fileName))}.`,
          evidence: [{ adr: adr.fileName }, { adr: elsewhere.fileName }],
          consequence:
            "A bare ADR number is directory-scoped by default (ADR-0008), so this reference does not resolve to the same-numbered ADR in another directory — write an explicit path, or declare `numbering: global` if numbers are unique across the whole log and a cross-directory supersession is intended.",
          advisory: true,
        });
        continue;
      }
      // Exists nowhere. superseded-by-nowhere is already fact-flagged as a
      // dangling supersession pointer; surface a dangling supersedes here so it
      // is never a silent no-op.
      if (kind === "supersedes") {
        findings.push({
          check: "D2",
          claim: `${formatAdrRef(adr.number)} declares \`supersedes: ${padAdrNumber(num)}\`, but no ${formatAdrRef(num)} exists anywhere in the log.`,
          evidence: [{ adr: adr.fileName }],
          consequence:
            "A supersedes pointer to a number that exists nowhere names a decision this ADR claims to replace but that can't be found — the reference is broken and can't be verified.",
          advisory: true,
        });
      }
    }
  }
  return findings;
}

function findMissingSupersededByTargets(adrs: ParsedAdr[], byNumber: Map<number, ParsedAdr>): Finding[] {
  const findings: Finding[] = [];
  for (const adr of adrs) {
    const target = parseAdrRef(adr.frontmatter["superseded-by"]);
    // Fires only when the number exists nowhere in the log — a genuinely
    // dangling pointer. A number that exists in another directory (but not
    // this one) is the cross-directory case above, not a missing target.
    if (target === null || byNumber.has(target)) continue;
    findings.push({
      check: "D2",
      claim: `ADR-${padAdrNumber(adr.number ?? 0)} declares \`superseded-by: ${padAdrNumber(target)}\`, but no ADR numbered ${padAdrNumber(target)} exists in the log.`,
      evidence: [{ adr: adr.fileName }],
      consequence:
        "A supersession pointer to nothing leaves the reader unable to find the decision that replaced this one — the status graph is broken at this node.",
    });
  }
  return findings;
}

// A readable identity for a graph node. Root-level ADRs read exactly as before
// (`ADR-0001`); a subdirectory ADR carries its directory so a genuine
// cross-directory case (only possible under `numbering: global`) still names the
// right file. The directory is fenced through code() — it is attacker-authorable
// (S3, ADR-0016 lineage).
function adrGraphLabel(adr: ParsedAdr): string {
  const dir = dirOf(adr.fileName);
  return dir === "" ? formatAdrRef(adr.number!) : `${formatAdrRef(adr.number!)} in ${code(`${dir}/`)}`;
}

// A pair key over directory-scoped identity (fileName), not bare number, so two
// independent supersession relationships that happen to reuse the same numbers
// in different directories are never collapsed into one (fix 4, the class Codex
// hit on the cycle path). fileName is unique across the whole log.
function pairKeyByFile(a: ParsedAdr, b: ParsedAdr): string {
  // Collision-safe over fileNames that may contain spaces or other separators
  // (edgex-docs has ADR filenames with spaces). JSON of the sorted pair is a
  // canonical, unambiguous key — no delimiter a real path could forge.
  return JSON.stringify([a.fileName, b.fileName].sort());
}

function findSupersessionCycles(
  adrs: ParsedAdr[],
  resolve: (from: ParsedAdr, num: number) => ParsedAdr | null
): Finding[] {
  const findings: Finding[] = [];
  // Key the graph by directory-scoped identity (fileName), not bare number. The
  // targets are resolved dir-scoped (ADR-0008), but storing edges by bare number
  // collapsed identically-numbered ADRs in different directories into one node,
  // fabricating a cycle out of two unrelated one-way per-directory chains (fix 4,
  // the per-directory-cycle-conflation adversarial fixture).
  const edges = new Map<string, string>();
  const nodeByFile = new Map<string, ParsedAdr>();
  for (const adr of adrs) {
    if (adr.number === null) continue;
    const target = parseAdrRef(adr.frontmatter["superseded-by"]);
    if (target === null) continue;
    const resolved = resolve(adr, target);
    if (resolved === null || resolved.number === null) continue;
    edges.set(adr.fileName, resolved.fileName);
    nodeByFile.set(adr.fileName, adr);
    nodeByFile.set(resolved.fileName, resolved);
  }

  const reported = new Set<string>();
  for (const start of edges.keys()) {
    if (reported.has(start)) continue;
    const path: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined) {
      const loopIndex = path.indexOf(current);
      if (loopIndex !== -1) {
        const cycle = path.slice(loopIndex);
        for (const f of cycle) reported.add(f);
        findings.push({
          check: "D2",
          claim: `Supersession cycle detected: ${cycle.map((f) => adrGraphLabel(nodeByFile.get(f)!)).join(" -> ")} -> ${adrGraphLabel(nodeByFile.get(cycle[0]!)!)}.`,
          evidence: cycle.map((f) => ({ adr: nodeByFile.get(f)!.fileName })),
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

function findMutualSupersession(
  adrs: ParsedAdr[],
  resolve: (from: ParsedAdr, num: number) => ParsedAdr | null
): { mutual: Finding[]; mutualPairs: Set<string> } {
  const findings: Finding[] = [];
  // Keyed by fileName pair, not bare number (fix 4, sibling of the cycle bug):
  // two distinct within-directory mutual pairs that reuse the same numbers in
  // different directories are separate findings, not one deduped away — and
  // `mutualPairs` flows into findStaleSupersession, so a bare-number key there
  // would let a team-b pair suppress a genuine team-a stale finding.
  const mutualPairs = new Set<string>();
  const reportedPairs = new Set<string>();

  for (const adr of adrs) {
    if (adr.number === null || adr.frontmatter.status !== "accepted") continue;
    for (const targetNum of parseAdrRefList(adr.frontmatter.supersedes)) {
      const target = resolve(adr, targetNum);
      if (!target || target.number === null || target.frontmatter.status !== "accepted") continue;
      const back = parseAdrRefList(target.frontmatter.supersedes).some(
        (n) => resolve(target, n)?.fileName === adr.fileName
      );
      if (!back) continue;

      const key = pairKeyByFile(adr, target);
      mutualPairs.add(key);
      if (reportedPairs.has(key)) continue;
      reportedPairs.add(key);

      const [lo, hi] = adr.number < target.number ? [adr, target] : [target, adr];
      findings.push({
        check: "D2",
        claim: `${adrGraphLabel(lo)} and ${adrGraphLabel(hi)} are both Accepted and each claims to supersede the other.`,
        evidence: [{ adr: lo.fileName }, { adr: hi.fileName }],
        consequence: "Mutual supersession between two live decisions leaves no single decision in force.",
      });
    }
  }

  return { mutual: findings, mutualPairs };
}

function findStaleSupersession(
  adrs: ParsedAdr[],
  resolve: (from: ParsedAdr, num: number) => ParsedAdr | null,
  mutualPairs: Set<string>
): Finding[] {
  const findings: Finding[] = [];
  for (const adr of adrs) {
    if (adr.number === null || adr.frontmatter.status !== "accepted") continue;
    for (const targetNum of parseAdrRefList(adr.frontmatter.supersedes)) {
      if (targetNum <= adr.number) continue;
      const target = resolve(adr, targetNum);
      if (!target || target.frontmatter.status !== "accepted") continue;
      // Skip pairs already reported as mutual, matched by fileName identity so a
      // same-numbered mutual pair in another directory can't suppress this one
      // (fix 4). resolve() runs first now so the fileName key is available.
      if (mutualPairs.has(pairKeyByFile(adr, target))) continue;
      findings.push({
        check: "D2",
        claim: `${adrGraphLabel(adr)} (Accepted) claims to supersede the later ${adrGraphLabel(target)}, which is still Accepted.`,
        evidence: [{ adr: adr.fileName }, { adr: target.fileName }],
        consequence:
          "An earlier decision cannot supersede a later one that was never updated — one status is stale.",
      });
    }
  }
  return findings;
}
