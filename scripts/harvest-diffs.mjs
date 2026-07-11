#!/usr/bin/env node
// M4.2 diff-candidate harvest (ADR-0041). Deterministic corpus construction:
// walks each repo's first-parent history newest-first from the captured HEAD,
// selects S3/S2 candidates by the STATED rule, caps 8 per repo per check, and
// records every selected SHA. Re-running this rule reproduces the same set.
// $0 — this script never touches the network beyond local git.
//
// Selection rule (the auditable law):
//   walk:   git rev-list --first-parent <capturedHead>, newest first
//   diff:   changed files = git diff-tree --no-commit-id --name-only -r <sha>^1 <sha>
//           (root commits have no parent and are excluded)
//   S3:     >=1 changed file matches the EXPORTED gate predicates
//           (DEPENDENCY_MANIFESTS basename / isStorageSchemaFile — imported,
//           never copied) AND no changed file is under the repo's ADR dir
//   S2:     >=1 changed file matches a `governs:` glob of an ADR that was
//           Accepted AT THAT COMMIT — ADR text read from the commit's tree
//           (git show <sha>:<adr>), never today's
//   both:   the ADR directory must be non-empty at the commit (the ADR log
//           context is otherwise unloadable — a candidate the pipeline cannot
//           read is not a candidate); exclusions under this clause are counted
//   cap:    newest-first, 8 per repo per check
//
// Usage: node scripts/harvest-diffs.mjs --manifest <m.json> --out <harvest.json>

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DIST = resolve("dist");
const { DEPENDENCY_MANIFESTS, basenameOf, isStorageSchemaFile } = await import(
  pathToFileURL(resolve(DIST, "tier1/gate.js"))
);
const { governedTouches } = await import(pathToFileURL(resolve(DIST, "adr/governs.js")));
const { parseAdrFile, ADR_FILENAME_RE } = await import(pathToFileURL(resolve(DIST, "adr/parse.js")));
const { isAccepted } = await import(pathToFileURL(resolve(DIST, "adr/status.js")));

const CAP = 8;

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });

const { values } = parseArgs({
  options: { manifest: { type: "string" }, out: { type: "string" } },
});
if (!values.manifest || !values.out) {
  console.error("harvest-diffs: --manifest and --out are required.");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf-8"));

const harvest = [];
for (const spec of manifest) {
  const root = resolve(spec.root);
  const adrDir = spec.adrDir ?? "docs/adr";
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (spec.capturedHead && !head.startsWith(spec.capturedHead)) {
    console.error(`${spec.label}: tree at ${head.slice(0, 12)}, captured at ${spec.capturedHead} — REFUSING`);
    process.exit(1);
  }

  // The governs report (per-repo, from today's tree): does this repo's log use
  // the convention at all? Reported, never assumed.
  const adrFilesToday = git(root, ["ls-files", adrDir]).split("\n").filter((f) => f && ADR_FILENAME_RE.test(basenameOf(f)));
  let governsCount = 0;
  for (const f of adrFilesToday) {
    try {
      const adr = parseAdrFile(readFileSync(resolve(root, f), "utf-8"), resolve(root, f), basenameOf(f));
      const g = adr.frontmatter.governs;
      if (Array.isArray(g) && g.length > 0) governsCount++;
    } catch { /* unreadable ADR contributes nothing to the report */ }
  }
  const s2Eligible = governsCount > 0;

  const shas = git(root, ["rev-list", "--first-parent", "HEAD"]).split("\n").filter(Boolean);
  const s3 = [];
  const s2 = [];
  let adrDirAbsentExclusions = 0;
  // Blob-level cache: ADR text at a commit is parsed once per distinct blob.
  const blobCache = new Map();

  for (const sha of shas) {
    if (s3.length >= CAP && (s2.length >= CAP || !s2Eligible)) break;
    let changed;
    try {
      changed = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", `${sha}^1`, sha])
        .split("\n").filter(Boolean);
    } catch {
      continue; // root commit — no first parent, excluded by rule
    }
    if (changed.length === 0) continue;

    const touchesAdrDir = changed.some((f) => f.startsWith(`${adrDir}/`));
    const signalFiles = changed.filter((f) => DEPENDENCY_MANIFESTS.has(basenameOf(f)) || isStorageSchemaFile(f));

    // Shared clause: the ADR dir must be non-empty at the commit.
    const adrDirAt = (candidateNeeded) => {
      if (!candidateNeeded) return false;
      const listing = (() => { try { return git(root, ["ls-tree", "-r", "--name-only", sha, adrDir]); } catch { return ""; } })();
      const ok = listing.split("\n").some((f) => f && ADR_FILENAME_RE.test(basenameOf(f)));
      if (!ok) adrDirAbsentExclusions++;
      return ok;
    };

    if (s3.length < CAP && signalFiles.length > 0 && !touchesAdrDir && adrDirAt(true)) {
      s3.push({ sha12: sha.slice(0, 12), changed: changed.length, signals: signalFiles.length });
    }

    if (s2Eligible && s2.length < CAP) {
      // Read every ADR from THIS commit's tree; accepted + governs from that state.
      let hit = false;
      const listing = (() => { try { return git(root, ["ls-tree", "-r", sha, adrDir]); } catch { return ""; } })();
      for (const line of listing.split("\n")) {
        const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
        if (!m || !ADR_FILENAME_RE.test(basenameOf(m[2]))) continue;
        const [_, blob, path] = m;
        let parsed = blobCache.get(blob);
        if (parsed === undefined) {
          try {
            const raw = git(root, ["cat-file", "blob", blob]);
            parsed = parseAdrFile(raw, path, basenameOf(path));
          } catch { parsed = null; }
          blobCache.set(blob, parsed);
        }
        if (!parsed || !isAccepted(parsed)) continue;
        const globs = parsed.frontmatter.governs;
        if (!Array.isArray(globs) || globs.length === 0) continue;
        if (governedTouches(changed, globs.map(String)).length > 0) { hit = true; break; }
      }
      if (hit) s2.push({ sha12: sha.slice(0, 12), changed: changed.length });
    }
  }

  harvest.push({
    label: spec.label, side: spec.side, root: spec.root, adrDir,
    head12: head.slice(0, 12),
    firstParentDepth: shas.length,
    governsAdrsToday: governsCount, s2Eligible,
    adrDirAbsentExclusions,
    s3, s2,
  });
  console.log(
    `${spec.label.padEnd(28)} depth=${String(shas.length).padStart(5)}  governs-ADRs=${governsCount}  S3: ${s3.length}  S2: ${s2.length}  adr-dir-absent-exclusions=${adrDirAbsentExclusions}`
  );
}

writeFileSync(resolve(values.out), `${JSON.stringify(harvest, null, 2)}\n`, "utf-8");
const totals = harvest.reduce((a, r) => ({ s3: a.s3 + r.s3.length, s2: a.s2 + r.s2.length }), { s3: 0, s2: 0 });
console.log(`\nharvest: ${totals.s3} S3 + ${totals.s2} S2 candidates → ${values.out}`);
