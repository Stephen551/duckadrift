import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatAdrRef } from "../adr/refs.js";
import type { AdrLogContext } from "../adr/types.js";
import type { Finding } from "../types.js";

const EXTERNAL_LINK_RE = /^[a-z][a-z0-9+.-]*:/i;

function dangleConsequence(target: string): string {
  return /\.md$/i.test(target)
    ? "A dangling ADR-to-ADR link breaks traceability for anyone following the decision trail."
    : "A dangling ADR-to-code link means the decision's cited implementation cannot be verified to exist.";
}

/** D3: reference integrity — PDR §2.3. */
export function d3ReferenceIntegrity(ctx: AdrLogContext): Finding[] {
  const findings: Finding[] = [];
  for (const adr of ctx.adrs) {
    const baseDir = dirname(adr.filePath);
    for (const link of adr.links) {
      const target = link.target.split("#")[0]!.trim();
      if (target === "" || EXTERNAL_LINK_RE.test(target)) continue;

      const resolved = resolve(baseDir, target);
      if (existsSync(resolved)) continue;

      findings.push({
        check: "D3",
        claim: `${adr.number !== null ? formatAdrRef(adr.number) : adr.fileName} links to \`${target}\`, which does not resolve at HEAD.`,
        evidence: [{ adr: adr.fileName, line: link.line }],
        consequence: dangleConsequence(target),
      });
    }
  }
  return findings;
}
