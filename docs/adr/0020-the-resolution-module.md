---
status: accepted
date: 2026-07-06
severity: elevated
---

# ADR-0020: The resolution module

## Status

Accepted — 2026-07-06.

## Context

ADR-0018 consolidated three duplicated primitives after five false positives traced to
each being kept in more than one copy. Link parsing was one of them, and the consolidation
gave it a single home: a hand-rolled scanner every check shared. That fixed the duplication
and left a deeper problem standing — a hand-rolled scanner of an inline grammar as subtle as
CommonMark is the bet ADR-0018 lost, placed once more in one location instead of several.

A probe of the scanner found it wrong three ways. Link text carrying its own brackets was
read past its close. An unterminated destination parenthesis swallowed the rest of the line.
And an escape rule stripped a legitimate `\#` into a fragment, turning a real filename into a
dangling reference — a false positive on a check that fails CI, the exact thing kill clause A
forbids. Each was patchable in isolation, but each patch was a guess at a specification
written down elsewhere and enforced by no test the tool owned. The lesson of ADR-0018,
restated: a primitive you hand-roll is a primitive you will get subtly wrong, and subtly
wrong in the deterministic tier is what the kill criterion exists to prevent.

Two facts made the replacement more than a swap. A spec-compliant parser resolves character
escapes as it parses, so the information one constraint needs — that `file\#name.md` is a
filename and not a path plus a fragment — is gone by the time a resolved URL reaches a check;
it is recovered by slicing the raw destination out of the node's own source position before
that resolution happens. And a strict parser drops a bare destination containing a space —
`[x](my file.md)` is not a valid inline link to the specification — which the tolerant
scanner had silently accepted. The first is kept; the second becomes a documented limit
rather than a tolerated ambiguity.

## Decision

1. **Reference extraction is a spec-compliant CommonMark parser, not a hand-rolled scanner.**
   The parser is `mdast-util-from-markdown`. Every reference-bearing node it produces is
   enumerated and handled — `link`, `image`, `linkReference`, `imageReference`, and
   `definition` — so a reference form the tool does not handle is a loud gap in a named list,
   not a silent miss. (Two such gaps were found and closed this way: image links were being
   dropped, and reference-style definitions escaped the escape-aware helper; both closed by
   making the node set complete rather than by adding a special case.)

2. **Reference resolution is one `resolveReference` ladder, shared by D2, D3, and D7.** The
   basename-fallback step is a parameter, not a fork. A hard gate that fails CI — D7's
   check that every index entry points at a file that exists — omits the fallback and
   requires the cited path itself to resolve. An advisory that never fails CI — D3's
   reference integrity — supplies the fallback and stays lenient. Strictness scales with
   consequence, expressed through one ladder, not two resolvers that drift apart.

3. **The escape-aware fragment rule is kept; the space-bearing bare destination is a
   documented limit.** Fragment handling is preserved by reading the raw destination from
   source positions before the parser's escape resolution erases it. A bare destination
   with an unescaped space is not resolved — the specification drops it, and the answer is
   the specification's own: the log author angle-brackets the path, `[x](<my file.md>)`. The
   limit is stated in LIMITS, not worked around with a second tolerant parser.

## Consequences

- The tool's most bug-prone primitive — the one behind the founding false positives — is now
  correct by construction against a written specification instead of correct by patching
  against the last probe. A CommonMark edge the tool has never seen is the parser's concern,
  not a future clause-A finding waiting for a reviewer to write it.
- The runtime dependency footprint rises by `mdast-util-from-markdown` (a clean audit) and
  `@types/mdast`. This is the correctness-by-construction trade ADR-0018's lesson demands,
  taken deliberately over the PDR's minimize-dependencies aspiration: the primitive that most
  needs to be right is the one that yields the dependency budget, and it is a narrow, audited,
  single-purpose parser, not a framework.
- The space-in-bare-destination limit is a real, documented gap. When the tool cannot resolve
  such a destination it says nothing and points to the angle-bracket convention — the honest
  silence of a stated limit, distinct from the dishonest silence of a check that missed.
- The module is complete as of the closing round on this branch: D7 was the last cell still
  extracting index links with its own line regex and matching them by basename. With its
  extraction moved onto the parser and its resolution onto the ladder, every markdown-parsing
  and reference-resolution path in the tool is one implementation. The scanner is superseded,
  not rewritten — its commit stays in history as the scar the records doctrine requires.
