---
status: accepted
date: 2026-07-06
severity: elevated
---

# ADR-0021: The full-surface adversarial pass, and the class it closed

## Status

Accepted — 2026-07-06.

## Context

With the resolution module built (ADR-0020), the pre-publish work could have stopped at
re-verifying the findings already reported. It did not. The founding false positives
(ADR-0018) and the scanner's leaks (ADR-0020) shared one shape — a primitive applied
correctly in one place and not another — and that shape is not found by waiting for a
reviewer to report an instance of it. It is found by listing every place a primitive should
be applied and checking whether it is. So the pass became systematic: every Tier 0 check
crossed with every threat class it could face — a false positive, a false negative, an
injection, a crash, a path traversal — an attack-surface matrix, with the cells no prior
audit had searched searched first.

The method was the ADR-0013 / ADR-0014 / ADR-0019 lineage at full extent: the verifier's own
structured sweep of the matrix, then two uncorrelated cross-vendor rounds — one red-team
framing (Codex), one audit framing (Gemini), run in separate sessions on the changed surface
— then a closing targeted round on the cells the fixes touched. Everything reported was
reproduced independently against the built tool before it counted.

The result confirmed the thesis by finding the signature bug five more times. Path
containment excluded the ADR directory by string prefix, so a sibling directory named
`docs/adr-extra` slipped the exclusion. The file-size cap guarded every scanned file but not
the config read, so a repository-controlled config could exhaust memory. External-reference
classification was decided separately by D3 and D7, and neither handled a Windows drive
letter or a protocol-relative URL correctly — one skipped a leaked local path, the other
failed a valid external link. Per-directory number-scoping computed numbering gaps globally
even when the log declared per-directory namespacing. And the flagship D5 gate compared a
git-quoted non-ASCII path against a raw one and fired on a record that had in fact been
modified. Alongside the recurrences were isolated defects: a shell-string git invocation the
diff base flowed into, an override marker that matched in prose, a glob that missed its own
dotfiles, a dialect detector that tipped on a single marker, and a config read that crashed
on a directory or a malformed file instead of failing loudly.

Three of these were clause-A false positives — a false CI failure is precisely what kill
clause A forbids — and two of the three surfaced only in the closing round, after the first
batch was fixed. That is the evidence the pass had to run to completion rather than stop at
the first clean-looking result. Two of them, the D5 quoting fault and a multi-line index
entry read as unlisted, were invisible to the corpus differential and caught only by a
reviewer or a probe writing a shape the corpus does not contain — the concrete vindication of
ADR-0019's rule that a clean differential never clears a tag on its own.

The pass also corrected the verifier. An earlier "verified clean" on the declared
per-directory case had rested on a fixture that passed for the wrong reason; the independent
re-derivation on the closing round's sharper input found the miss and fixed it. A review
layer that reproduces its own claims and catches one of them wrong is the method working, not
a hole in it.

## Decision

1. **Each recurrence is fixed by consolidation onto one shared implementation, never a
   per-instance patch** — the ADR-0018 ruling applied across the whole matrix. Path
   containment is one boundary-aware `isPathInside`. The file-size cap is one constant applied
   at every read. External classification is one `isExternalReference` used by D3 and D7
   alike. Number-scoping honors the declared namespace in one place, with the auto-detection
   heuristic (ADR-0008) reached only when the log declares nothing. Report-escaping routes
   every author-supplied string through one `code()` helper. Five primitives, one
   implementation each.

2. **The isolated defects are fixed at their root, not masked.** The git invocation is an
   argument array with no shell and quoting disabled at the source. The override marker is
   trailer-scoped, not matched in prose. The glob sets `dot: true`. The dialect detector
   requires two markers. The config read requires a regular file and catches its parse error
   into a loud exit-2 setup error — a crash with no report is a silence, and silence is a
   violation.

3. **The attack-surface matrix is the pass's artifact and the coordinate system for the
   ADR-0019 gate.** ADR-0019 already scopes a tag's adversarial pass to the changed surface;
   this pass gives "changed surface" a precise definition. A change's surface is the set of
   matrix cells it reaches, and — because each primitive is now single-sourced — that set is
   small and computable: a change to a shared primitive is every cell that uses it, and a
   change to one check is that check alone. The tier still escalates when uncertain, exactly
   as ADR-0019 directs; what the matrix adds is the ability to say which cells a diff cannot
   reach, and the consolidation is what makes that claim sound. This equips the standing gate;
   it does not loosen it.

## Consequences

- The tool's own signature failure class is closed by construction. Before the pass, a fix to
  one check's copy of a primitive left its siblings drifting — the exact bug the tool hunts,
  living inside the tool. After it, there are no siblings: a change to a primitive changes
  every user at once, and a change to a check can only break that check. The multi-round
  treadmill of the recent tags — patch an instance, ship, find the same bug in the next
  instance — ends here, not through more diligence but by removing the duplication diligence
  was compensating for.
- The clause-A ledger for the coming tag is three false positives found and fixed before a
  listing exists to be embarrassed by them, per ADR-0019's pre-tag ordering. None survived
  triage; kill clause A's post-publish window becomes a re-confirmation of a result already
  established.
- The changes are correctness within the semver contract, not breaks: report format, config
  keys, frontmatter vocabulary, and exit codes are unchanged. The corpus differential across
  the internal logs and the external R5 repositories — cosmos-sdk, backstage, edgex-docs,
  terraform-provider-proxmox, and opendatahub — is byte-identical but for one genuine
  per-team numbering gap surfaced on opendatahub, a true positive rather than a regression.
- ADR-0019 and this record compound. The first made the adversarial pass standing; this one
  makes it addressable — future review is scoped rather than blanket, and the scoping is
  legitimate precisely because the primitives it relies on are unified. The gate now has a map.
