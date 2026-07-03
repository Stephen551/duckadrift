import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatAdrRef } from "../adr/refs.js";
import { walkAllPaths } from "../repo/walk.js";
import type { AdrLogContext } from "../adr/types.js";
import type { Finding } from "../types.js";

const EXTERNAL_LINK_RE = /^[a-z][a-z0-9+.-]*:/i;
// `[Name](@handle)` is a GitHub-attribution-mention idiom, not a file or code
// reference — found running R5's opendatahub, whose Authors table cites
// reviewers this way. Matches a bare GitHub-username-shaped target ONLY: no
// `/`, no `.`, nothing after the handle. An unanchored `/^@/` (the first cut
// of this fix) would also silently swallow npm/yarn scoped-package targets
// like `@backstage/core-plugin-api` — a real shape, since Backstage-style
// monorepos are in this tool's own exam set — turning a would-be dangling
// reference into a false negative instead of the false positive this was
// built to fix. A bare `@` with nothing after it (found in the same corpus,
// an evidently unfilled attribution slot) is correctly NOT a match here and
// falls through to normal existence checking.
const USERNAME_MENTION_RE = /^@[a-zA-Z0-9](?:-?[a-zA-Z0-9])*$/;
// `[Name](user@domain.tld)` is a bare-email attribution idiom (found running
// R5's opendatahub: a reviewer table citing people this way instead of a
// `mailto:` link), not a file or code reference. Excludes `/` throughout so
// it can't collide with a scoped-package target like `@myscope/name` (which
// always has a `/` and never a domain-shaped `.tld` after it) — the two
// idioms share "exactly one `@`" but are otherwise structurally distinct.
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

function dangleConsequence(target: string): string {
  return /\.md$/i.test(target)
    ? "A dangling ADR-to-ADR link breaks traceability for anyone following the decision trail."
    : "A dangling ADR-to-code link means the decision's cited implementation cannot be verified to exist.";
}
// ADR-0011: a link that doesn't resolve under any of the conventions above
// might still be genuine — written for a published doc site's URL depth
// (found running R5: edgex-docs' ADR-0026, cosmos-sdk's ADR-054), not the
// raw git tree. The dominant version of that idiom is extensionless and
// often trailing-slash (MkDocs/Docusaurus "pretty URLs" — "../adr/foo/",
// not "../adr/foo.md"), handled by findByBasename's normalization below.
// If a file with the same basename exists anywhere else in the repo,
// that's provable (the file is real) but not provable-as-error (the link
// might render correctly on the published site) — advisory, with the
// discovered path folded in so a human can jump straight to it. A target
// with no match anywhere in the tree has nothing to explain it away with
// — stays fact.
const SITE_RELATIVE_CONSEQUENCE =
  "A link written for a published doc site's URL depth can look broken in the raw repository tree even though the target exists — confirm whether this needs fixing for direct GitHub browsing, or just reflects how the site renders it.";

/** D3: reference integrity — PDR §2.3. */
export function d3ReferenceIntegrity(ctx: AdrLogContext): Finding[] {
  const findings: Finding[] = [];
  // Lazy and cached: only built the first time a link actually fails to
  // resolve, reused for every dangling link after that in this same call —
  // not one repo-wide walk per link.
  let basenameIndex: Map<string, string> | null = null;
  let indexDirIndex: Map<string, string> | null = null;
  function buildIndices(): void {
    if (basenameIndex) return;
    basenameIndex = new Map();
    indexDirIndex = new Map();
    for (const f of walkAllPaths(ctx.repoRoot)) {
      const segments = f.relativePath.split("/");
      const base = segments[segments.length - 1]!;
      if (!basenameIndex.has(base)) basenameIndex.set(base, f.relativePath);
      // MkDocs/Docusaurus per-page-directory convention: a bare slug link
      // can map to <slug>/index.md, not <slug>.md — found alongside the
      // trailing-slash gap below, the other half of the same idiom.
      if (base.toLowerCase() === "index.md" && segments.length >= 2) {
        const parentDir = segments[segments.length - 2]!;
        if (!indexDirIndex.has(parentDir)) indexDirIndex.set(parentDir, f.relativePath);
      }
    }
  }

  function findByBasename(target: string): string | undefined {
    buildIndices();
    // The dominant MkDocs/Docusaurus idiom (found running R5's edgex-docs,
    // caught in verifier review): a site-relative link is written without
    // an extension and often with a trailing slash — "../../adr/foo/", not
    // "foo.md". A raw split("/").pop() on a trailing-slash target returns
    // "" (nothing follows the last slash), which can never match anything.
    // Strip the trailing slash first, then — if the resulting slug has no
    // extension of its own — try the two source shapes that idiom actually
    // maps to: "<slug>.md" and "<slug>/index.md".
    const stripped = target.replace(/\/+$/, "");
    const slug = stripped.split("/").pop()!;
    if (slug === "") return undefined;

    const direct = basenameIndex!.get(slug);
    if (direct !== undefined) return direct;

    if (!/\.[a-z0-9]+$/i.test(slug)) {
      const withMd = basenameIndex!.get(`${slug}.md`);
      if (withMd !== undefined) return withMd;
      const asIndexDir = indexDirIndex!.get(slug);
      if (asIndexDir !== undefined) return asIndexDir;
    }

    return undefined;
  }

  for (const adr of ctx.adrs) {
    const baseDir = dirname(adr.filePath);
    for (const link of adr.links) {
      const target = link.target.split("#")[0]!.trim();
      if (
        target === "" ||
        EXTERNAL_LINK_RE.test(target) ||
        USERNAME_MENTION_RE.test(target) ||
        EMAIL_RE.test(target)
      )
        continue;

      // A leading "/" is GitHub's own repo-root-relative convention for a
      // link within the same repo (found running R5's opendatahub) — not an
      // OS-absolute path, which no legitimate ADR reference is ever written
      // as. Resolved on its own, before the ADR-dir/repo-root fallback pair
      // below: a leading "/" unambiguously signals "not relative to me."
      const resolved = target.startsWith("/")
        ? existsSync(resolve(ctx.repoRoot, target.replace(/^\/+/, "")))
        : // Primary: relative to the ADR's own directory (the markdown-
          // correct reading of a relative link). Fallback: relative to repo
          // root — a real, common ADR convention (cite code paths the way
          // you'd type them from the repo root), confirmed running against
          // a real repo during Gate G1 where every code citation used this
          // style.
          existsSync(resolve(baseDir, target)) || existsSync(resolve(ctx.repoRoot, target));

      if (resolved) continue;

      const foundPath = findByBasename(target);
      if (foundPath !== undefined) {
        findings.push({
          check: "D3",
          claim: `${adr.number !== null ? formatAdrRef(adr.number) : adr.fileName} links to \`${target}\`, which does not resolve at HEAD (possibly site-relative — found at \`${foundPath}\`).`,
          evidence: [
            { adr: adr.fileName, line: link.line },
            { file: foundPath },
          ],
          consequence: SITE_RELATIVE_CONSEQUENCE,
          advisory: true,
        });
        continue;
      }

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
