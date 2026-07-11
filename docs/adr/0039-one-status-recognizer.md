---
status: accepted
date: 2026-07-11
severity: elevated
---

# ADR-0039: One status recognizer — a decision's state is read the same way everywhere

## Status

Accepted — 2026-07-11.

## Context

The calibration corpus capture stopped when five of seven public repositories yielded
nothing: their records declare status as a Status heading section — the original ADR
form's own canonical dialect — and nothing in the codebase read it. The gap was not local
to the semantic tier's selector. The parser extracts status only from frontmatter, so a
heading-dialect record is invisible to every status-gated behavior in the product, and the
semantic selector had already grown a second recognizer for a bold-line dialect the parser
also missed. Two recognizers disagreeing about the same fact, with a third about to be
patched in, is the exact drift this tool exists to catch — found inside the tool, again,
by the corpus doing its job as a reality check.

## Decision

Status is resolved by one shared primitive. It reads, in declared-first order: YAML
frontmatter; a Status heading section, tolerating a leading symbol and a trailing date;
the bold-line dialect the selector previously matched alone. The first form a record
declares wins, and a later dialect never overrides an earlier one. The semantic tier's
selector delegates to this primitive immediately. The deterministic checks that gate on
accepted status adopt the same primitive as a named follow-up change of their own — their
verdicts change on heading-dialect repositories, which is a product improvement that
deserves its own fixtures and its own review, not a rider inside a paused capture.

## Consequences

- The corpus capture resumes able to read the majority dialect, and the calibration
  measures the checks against records as the wild actually writes them.
- The product's deterministic coverage gap on heading-dialect repositories is now a
  recorded, scheduled fix rather than an unknown — the corpus surfaced a real defect
  before any user did.
- There is exactly one answer to "what status does this record declare," with its source
  named, and future dialects extend one primitive instead of forking a new recognizer.
- Existing recordings and fixtures are untouched: recognition is additive, and the
  selector's behavior on frontmatter and bold-line logs is byte-identical.
