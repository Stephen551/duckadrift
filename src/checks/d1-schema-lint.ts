import { dirname } from "node:path";
import { REQUIRED_SECTIONS, SECTION_ALIASES, sectionSatisfied } from "../adr/dialect.js";
import { formatAdrRef, padAdrNumber } from "../adr/refs.js";
import type { AdrLogContext, ParsedAdr } from "../adr/types.js";
import type { Finding } from "../types.js";

const VALID_STATUSES = new Set(["proposed", "accepted", "rejected", "superseded", "deprecated"]);

const DUPLICATE_CONSEQUENCE =
  "Duplicate numbering makes ADR references ambiguous; downstream ghost-reference and status-graph checks cannot resolve a single target.";
// Found running R5's opendatahub: a number reused across per-team
// subdirectories may be an intentional convention, not a mistake — the tool
// can't disprove that, so (ADR-0008) it can't assert the cross-directory
// case as fact the way a same-directory collision still is.
const CROSS_DIRECTORY_CONSEQUENCE =
  "A number reused across directories may be an intentional per-directory namespace, or a genuine collision — declare `numbering: global` in `.duckadrift.yml` if this repo's numbers must be unique across the whole log.";
// Found running R5's cosmos-sdk: ADR-050 is one decision told across a
// main doc and two explicitly-named annexes (doctrine Q2, ADR-0009) — a
// recognizable multi-file-per-decision convention, not an authoring
// accident, when every file in the collision shares a base filename and
// differs only by a known annex/companion-style suffix.
const ANNEX_CONSEQUENCE =
  "A shared base filename with an annex/companion-style suffix is a recognizable multi-file-per-decision convention, not necessarily a numbering mistake — confirm it's intentional if this repo doesn't use that pattern on purpose.";
// ADR-0010: a gap is a provable state (the number genuinely doesn't exist),
// not a provable error — numbers retire legitimately (a withdrawn proposal,
// a renumbering) in real, mature logs. Advisory by default; a repo can
// declare numbering_gaps: fail to keep the old hard-fail behavior.
const NUMBERING_GAP_CONSEQUENCE =
  "A skipped number is either a lost ADR or a numbering error; both need a human to confirm which.";

// Deliberately narrow (ADR-0009): only a well-known documentary-annex
// vocabulary counts as "recognizable," so this can't silently swallow a
// genuine duplicate-numbering mistake in some other repo whose filenames
// happen to share an unrelated suffix.
const ANNEX_SUFFIX_RE = /^-(?:annex|appendix|companion|addendum|supplement|part)-?[a-z0-9]*$/i;
// The slug is whatever follows the number-and-hyphen prefix, before ".md" —
// re-derived here (not reusing ADR_FILENAME_RE's capture) since D1 only has
// the already-resolved fileName, not the raw match.
const SLUG_RE = /^(?:[a-zA-Z]+-?)*\d+-(.+)\.md$/i;

function slugOf(fileName: string): string | null {
  const base = fileName.split("/").pop()!;
  const match = SLUG_RE.exec(base);
  return match ? match[1]! : null;
}

function isAnnexShaped(group: ParsedAdr[]): boolean {
  const slugs = group.map((a) => slugOf(a.fileName));
  if (slugs.some((s) => s === null)) return false;
  const known = slugs as string[];
  const base = known.reduce((shortest, s) => (s.length < shortest.length ? s : shortest));
  return known.every(
    (s) => s === base || (s.startsWith(`${base}-`) && ANNEX_SUFFIX_RE.test(s.slice(base.length)))
  );
}

function titleCase(heading: string): string {
  return heading
    .split(" ")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function orJoin(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

// The full set of headings that would satisfy this requirement — not just
// the one name the dialect happens to call it, since a repo's own template
// might use any recognized alias (SECTION_ALIASES, ADR-0004).
function sectionLabels(required: string): string {
  const aliases = SECTION_ALIASES[required] ?? [required];
  return orJoin(aliases.map((a) => `\`## ${titleCase(a)}\``));
}

// dirname() on a bare root-level filename ("0001-foo.md") returns "." —
// "the ADR root" reads better in a claim than a bare dot.
function directoryLabel(dir: string): string {
  return dir === "." ? "the ADR root" : `\`${dir}/\``;
}

/** D1: schema/structure lint — PDR §2.3. */
export function d1SchemaLint(ctx: AdrLogContext): Finding[] {
  const findings: Finding[] = [];
  const byNumber = new Map<number, ParsedAdr[]>();
  for (const adr of ctx.adrs) {
    if (adr.number === null) continue;
    const group = byNumber.get(adr.number) ?? [];
    group.push(adr);
    byNumber.set(adr.number, group);
  }

  // ADR-0008: the numbering namespace is the directory, not the whole ADR
  // root, unless the repo declares numbering: global. Same-directory is
  // still an unexplainable, provable collision — fact-tier either way.
  if (ctx.numberingScope === "global") {
    for (const [number, group] of byNumber) {
      if (group.length > 1) {
        const annexShaped = isAnnexShaped(group);
        findings.push({
          check: "D1",
          claim: `ADR number ${padAdrNumber(number)} is claimed by ${group.length} files.`,
          evidence: group.map((a) => ({ adr: a.fileName })),
          consequence: annexShaped ? ANNEX_CONSEQUENCE : DUPLICATE_CONSEQUENCE,
          ...(annexShaped ? { advisory: true } : {}),
        });
      }
    }
  } else {
    for (const [number, group] of byNumber) {
      if (group.length <= 1) continue;

      const byDirectory = new Map<string, ParsedAdr[]>();
      for (const adr of group) {
        const dir = dirname(adr.fileName);
        const dirGroup = byDirectory.get(dir) ?? [];
        dirGroup.push(adr);
        byDirectory.set(dir, dirGroup);
      }

      for (const [dir, dirGroup] of byDirectory) {
        if (dirGroup.length <= 1) continue;
        const annexShaped = isAnnexShaped(dirGroup);
        findings.push({
          check: "D1",
          claim: `ADR number ${padAdrNumber(number)} is claimed by ${dirGroup.length} files in ${directoryLabel(dir)}.`,
          evidence: dirGroup.map((a) => ({ adr: a.fileName })),
          consequence: annexShaped ? ANNEX_CONSEQUENCE : DUPLICATE_CONSEQUENCE,
          ...(annexShaped ? { advisory: true } : {}),
        });
      }

      if (byDirectory.size > 1) {
        const dirLabels = [...byDirectory.keys()].map(directoryLabel).join(", ");
        findings.push({
          check: "D1",
          claim: `ADR number ${padAdrNumber(number)} is claimed by files in ${byDirectory.size} different directories (${dirLabels}).`,
          evidence: group.map((a) => ({ adr: a.fileName })),
          consequence: CROSS_DIRECTORY_CONSEQUENCE,
          advisory: true,
        });
      }
    }
  }

  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1]!;
    const curr = numbers[i]!;
    if (curr - prev > 1) {
      const after = byNumber.get(curr)![0]!;
      for (let missing = prev + 1; missing < curr; missing++) {
        findings.push({
          check: "D1",
          claim: `ADR numbering skips ${padAdrNumber(missing)} between ${padAdrNumber(prev)} and ${padAdrNumber(curr)}.`,
          evidence: [{ adr: after.fileName }],
          consequence: NUMBERING_GAP_CONSEQUENCE,
          ...(ctx.numberingGapsMode === "advisory" ? { advisory: true } : {}),
        });
      }
    }
  }

  for (const adr of ctx.adrs) {
    const status = adr.frontmatter.status;
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      findings.push({
        check: "D1",
        claim: `${adr.number !== null ? formatAdrRef(adr.number) : adr.fileName} has status \`${status}\`, which is not a valid status for this dialect.`,
        evidence: [{ adr: adr.fileName }],
        consequence:
          "An unrecognized status value makes this ADR invisible to status-graph and staleness checks that filter on valid statuses.",
      });
    }

    const required = REQUIRED_SECTIONS[adr.dialect];
    const headings = new Set(adr.sections.map((s) => s.heading.toLowerCase().trim()));
    for (const req of required) {
      if (!sectionSatisfied(req, headings)) {
        const ref = adr.number !== null ? formatAdrRef(adr.number) : adr.fileName;
        // A guessed dialect is a guess: asserting "missing" as fact when the
        // user never declared their template would be exactly the kind of
        // confident-but-wrong claim Tier 0's zero-false-positive contract
        // forbids (ADR-0005). Declared dialects still fail CI, "required"
        // and all — the user told the tool this is their template. Without
        // a declaration, the claim is an observation plus an invitation, not
        // an assertion of a rule this repo never agreed to: "no section
        // found" instead of "missing the required section," ending in how
        // to declare a dialect if this log does have a house template.
        const claim = ctx.dialectDeclared
          ? `${ref} is missing the required ${sectionLabels(req)} section for its dialect.`
          : `${ref}: no ${sectionLabels(req)} section found — if this log uses a house template, declare it in \`.duckadrift.yml\`.`;
        findings.push({
          check: "D1",
          claim,
          evidence: [{ adr: adr.fileName }],
          consequence: "A decision record with no recorded decision fails its one job.",
          ...(ctx.dialectDeclared ? {} : { advisory: true }),
        });
      }
    }
  }

  return findings;
}
