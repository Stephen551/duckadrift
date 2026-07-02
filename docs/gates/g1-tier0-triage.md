# Gate G1 — Tier 0 external-repo triage

PDR §4 (M1): "run against all four internal repos; every finding hand-triaged
TRUE. One false positive = stop, fix or cut the check before proceeding
(kill clause A rehearsal)."

This is the sanitized triage record for that run. Repo identity, ADR
content, file paths, and claim/consequence text are deliberately excluded
so this file is safe to commit publicly — only check ID, a stable finding
ID, and the triage verdict. A single FALSE verdict is a Clause A kill-clause
trigger (PDR §1.5): halt Tier 1 work, fix or cut the offending check before
M1 is considered to pass Gate G1.

## Generating the input

From the duckadrift repo:

```
npm run build
node dist/cli/index.js report <path-to-internal-repo> --out /tmp/<label>-report.md
```

Repeat once per internal repo. `report` also writes `<label>-report.json`
alongside the markdown — that's the file to read findings from for triage;
nothing needs to be typed by hand except the verdict.

If a repo's ADR directory isn't `docs/adr` or `doc/adr`, the CLI throws
"No ADR directory found" (v1 only auto-detects those two paths per PDR
§2.2) — note that as a finding of its own rather than silently skipping.

**Finding ID** = `{check}-{n}`, where `n` is the finding's 1-based position
within its check's group in `report.json`'s `tier0Findings` array (filtered
by `check`, read in array order). The array is deterministically sorted
(PDR §3.2), so this numbering is stable across repeat runs on an unchanged
tree — re-running the same repo reproduces the same IDs.

Repo labels below are generic (`internal-1`..`internal-4`) by design. PDR
§1.3 already names the four repos in this repo's own history, so nothing
is gained by hiding the identity from yourself — only by not repeating it
in a file meant for public commit. Substitute real names in your own
private copy if that's more useful; keep the committed version generic.

## Triage

| Repo | Check | Finding | Verdict |
|------|-------|---------|---------|
| internal-1 | | | |

## Summary

| Repo | Findings | TRUE | FALSE |
|------|----------|------|-------|
| internal-1 | | | |
| internal-2 | | | |
| internal-3 | | | |
| internal-4 | | | |

Gate G1 passes only when every row above reads TRUE and every FALSE column
is zero.
