import { dirname } from "node:path";
import { decodeTarget } from "../adr/parse.js";
import { isExternalReference, makeBasenameFinder, resolveReference } from "../adr/resolve.js";
import { formatAdrRef } from "../adr/refs.js";
import { code } from "../report/write.js";
import type { AdrLogContext } from "../adr/types.js";
import type { Finding } from "../types.js";
// `[Name](@handle)` is a GitHub-attribution-mention idiom, not a file or code
// reference — found running R5's opendatahub, whose Authors table cites
// reviewers this way. Matches a bare GitHub-username-shaped target ONLY: no
// `/`, no `.`, nothing after the handle. An unanchored `/^@/` (the first cut
// of this fix) would also silently swallow npm/yarn scoped-package targets
// like `@backstage/core-plugin-api` — a real shape, since Backstage-style
// monorepos are in this tool's own exam set — turning a would-be dangling
// reference into a false negative instead of the false positive this was
// built to fix. The handle is optional: a bare `@` with nothing after it
// (found in the same corpus, an unfilled attribution slot — `[Chris Sams](@)`)
// is the same mention idiom with an empty handle, not a repo path, and was
// still being existence-checked and false-flagged before v0.1.4's clause-A
// pass. A scoped-package target still carries a `/`, so it is still not a match
// here and stays existence-checked — the narrow skip, by design.
const USERNAME_MENTION_RE = /^@(?:[a-zA-Z0-9](?:-?[a-zA-Z0-9])*)?$/;
// `[Name](user@domain.tld)` is a bare-email attribution idiom (found running
// R5's opendatahub: a reviewer table citing people this way instead of a
// `mailto:` link), not a file or code reference. Excludes `/` throughout so
// it can't collide with a scoped-package target like `@myscope/name` (which
// always has a `/` and never a domain-shaped `.tld` after it) — the two
// idioms share "exactly one `@`" but are otherwise structurally distinct.
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
// Issue #2: the bare-email skip (above) reads `author@notes.md` as an email —
// `.md` is domain-shaped (it is Moldova's actual TLD) — and silently swallows
// what may be a dangling file reference: a false negative. But the collision is
// real in both directions: a genuine Moldovan (or Serbian `.rs`, St Helenian
// `.sh`) email address is possible, so existence-checking these as fact-tier
// findings would manufacture the opposite failure — a clause-A false positive
// on a real attribution. The resolution: an email-shaped target whose final
// dot-segment is a known file extension is not skipped; it goes through the
// resolver, and if it dangles it surfaces as an ADVISORY whose claim is true
// under either reading. The extension list is deliberately file-signal-heavy
// and excludes common email TLDs (.com, .io, .co, .ai, .me are absent).
const EMAIL_AMBIGUOUS_EXTENSIONS = new Set([
  "adoc", "c", "cjs", "cpp", "cs", "go", "h", "hpp", "java", "js", "json",
  "jsx", "markdown", "md", "mdx", "mjs", "py", "rb", "rs", "rst", "sh",
  "sql", "toml", "ts", "tsx", "txt", "yaml", "yml",
]);


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
  const findByBasename = makeBasenameFinder(ctx.repoRoot);

  for (const adr of ctx.adrs) {
    const baseDir = dirname(adr.filePath);
    for (const link of adr.links) {
      const ref = adr.number !== null ? formatAdrRef(adr.number) : adr.fileName;

      // A malformed destination — an unclosed `<` angle bracket — is not a valid
      // CommonMark link. Surface it as a low-severity advisory rather than
      // inventing a phantom target (`missing.md`) and hard-failing on it (F4).
      if (link.malformed) {
        findings.push({
          check: "D3",
          claim: `${ref} has a malformed link destination on line ${link.line} — an unclosed \`<\` angle bracket, which is not a valid CommonMark link.`,
          evidence: [{ adr: adr.fileName, line: link.line }],
          consequence:
            "A malformed link destination does not render as a link and cannot be resolved — confirm the intended target and close or remove the angle bracket.",
          advisory: true,
        });
        continue;
      }

      // The scanner already resolved escapes and stripped the title and fragment,
      // so `link.target` is the resolvable path — no per-check re-parsing (an
      // escaped `\#` is part of the path, not a fragment: F2).
      const target = link.target;
      // Issue #2: an email-shaped target ending in a known file extension is
      // ambiguous — it may be a file whose name contains an `@`. It is NOT
      // skipped; it goes through the resolver, and a dangling one surfaces as an
      // advisory below. Only extension-less (or non-file-extension) email shapes
      // stay skipped, exactly as ADR-0016 decided.
      const emailShaped = EMAIL_RE.test(target);
      const emailExt = emailShaped ? target.slice(target.lastIndexOf(".") + 1).toLowerCase() : "";
      const emailShapedFileLike = emailShaped && EMAIL_AMBIGUOUS_EXTENSIONS.has(emailExt);
      if (
        target === "" ||
        isExternalReference(target) || // RV-2: the full shared primitive (scheme + protocol-relative `//`), matching D7
        USERNAME_MENTION_RE.test(target) ||
        (emailShaped && !emailShapedFileLike)
      )
        continue;

      // The one shared resolver — parse-normalized in, disposition out. D3's
      // behavior is unchanged (the differential proves it); the ladder just lives
      // in one place now, called by D7 and D2 too.
      const result = resolveReference({
        baseDir,
        target,
        rawTarget: link.rawTarget,
        repoRoot: ctx.repoRoot,
        findByBasename,
      });

      if (result.status === "resolved") continue;

      if (result.status === "raw-only-advisory") {
        findings.push({
          check: "D3",
          claim: `${ref} links to ${code(target)}, which does not resolve at HEAD — but a file named ${code(decodeTarget(link.rawTarget))} exists, so the link resolves if the trailing group is part of the filename rather than a Markdown title.`,
          evidence: [{ adr: adr.fileName, line: link.line }],
          consequence:
            "A bare destination ending in a parenthesized or quoted group is ambiguous — confirm whether the group is part of the path (angle-bracket it if so) or a title over a broken link.",
          advisory: true,
        });
        continue;
      }

      if (result.status === "site-relative-advisory") {
        // Issue #8: when other files share the resolved basename, name them so a
        // reader is not pointed at one candidate as if it were the only one
        // (ADR-0024). Capped at three named plus a count. Empty → no suffix, so
        // the unique-basename claim is byte-identical to its previous form.
        const others = result.otherCandidates ?? [];
        const n = others.length;
        let suffix = "";
        if (n === 1) {
          suffix = `; 1 other file shares this basename: ${code(others[0]!)}`;
        } else if (n === 2 || n === 3) {
          suffix = `; ${n} other files share this basename: ${others.map(code).join(", ")}`;
        } else if (n > 3) {
          suffix = `; ${n} other files share this basename: ${others.slice(0, 3).map(code).join(", ")}, and ${n - 3} more`;
        }
        findings.push({
          check: "D3",
          claim: `${ref} links to ${code(target)}, which does not resolve at HEAD (possibly site-relative — found at ${code(result.resolvedPath!)}${suffix}).`,
          evidence: [
            { adr: adr.fileName, line: link.line },
            { file: result.resolvedPath! },
          ],
          consequence: SITE_RELATIVE_CONSEQUENCE,
          advisory: true,
        });
        continue;
      }

      // status === "dangling": nothing resolves under any form.
      // Issue #2: an email-shaped, file-extension-ended dangling target is
      // irreducibly ambiguous — a file that doesn't resolve, or an email
      // attribution. Surface it as an advisory whose claim is true under either
      // reading, never as a fact-tier finding (clause A).
      if (emailShapedFileLike) {
        findings.push({
          check: "D3",
          claim: `${ref} links to ${code(target)}, which is shaped like an email address but ends in ${code("." + emailExt)} — a file extension — and does not resolve as a file at HEAD.`,
          evidence: [{ adr: adr.fileName, line: link.line }],
          consequence:
            "The two readings carry opposite dispositions: a file reference here dangles, while an email attribution is fine as written. A `mailto:` prefix makes an email explicit; a resolving path makes a file checkable.",
          advisory: true,
        });
        continue;
      }
      findings.push({
        check: "D3",
        claim: `${ref} links to ${code(target)}, which does not resolve at HEAD.`,
        evidence: [{ adr: adr.fileName, line: link.line }],
        consequence: dangleConsequence(target),
      });
    }
  }
  return findings;
}
