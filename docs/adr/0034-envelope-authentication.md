---
status: accepted
date: 2026-07-10
severity: elevated
---

# ADR-0034: Envelope authentication — a document boundary the document cannot forge

## Status

Accepted — 2026-07-10.

## Context

The semantic tier wraps each inspected document in envelope markers and tells the model
that everything between them is untrusted repository content. The adversarial round
showed the markers were forgeable: a document body is arbitrary text and can contain the
literal delimiter, counterfeiting a boundary in the assembled request. The citation
validator caught the resulting fabrication — the finding still had to quote real content —
so this was a defense-in-depth gap, not a backstop breach, and it was scheduled as its
own change rather than rushed into the backstop fix. It is hardened now, before the
remaining semantic checks arrive, so every document-consuming check is born on an
authenticated envelope.

## Decision

Each request's document boundaries carry a nonce that the document cannot produce. The
nonce is derived by hashing the request's own document payload — labels, paths, and
contents — and embedding the resulting token in every header and footer for that request.
The preamble names that token as the only authentic boundary marker, so an envelope-like
line inside a document, lacking the token, is read as content and not a boundary.

The nonce is derived rather than random for one specific reason: the recorded-response
harness matches a request by hash, and a random nonce would change that hash on every
call and break every replay. A content-derived nonce is stable for a given set of
documents — so recordings stay valid and replay works — while remaining unpredictable to
a document author, who cannot embed the hash of a payload that includes their own bytes
without solving a fixed point. The security property required here is unpredictability to
the document, not cryptographic secrecy, and derivation delivers exactly that. Document
content is never escaped, encoded, or mutated: the citation validator matches evidence as
verbatim bytes, so the content that reaches the model must be the content that will be
cited. Only the fence changes; the enclosed bytes do not.

## Consequences

- A document can print the literal delimiter and gains nothing: without the per-request
  token it forges no boundary, and the forgery attempt sits inside the authentic envelope
  as the content it is.
- The envelope is one primitive shared by every semantic check; authenticating it once
  reaches every present and future check by construction, and the adversarial corpus
  guards it against regression.
- Existing recordings are re-keyed to the new request shape through the legitimate
  re-record flow — the prompt structure changed deliberately and loudly, and the
  stale-recording gate is the proof the re-key is correct.
- This closes the envelope surface as defense-in-depth. The citation validator remains
  the backstop; authentication means a document must defeat both layers, not one, to
  reach a false finding — and defeating the validator is the byte-verbatim wall the
  adversarial round already showed holds.
