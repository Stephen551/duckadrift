# ADR-0011: Heading-declared status wrapped in markdown emphasis

## Status

**Approved**

## Context

edgex-docs's real shape: a `## Status` heading whose value is wrapped in bold
emphasis. The emphasis characters leaked into the token as `approved**`,
corrupting the value. Emphasis is stripped so the token is the bare word.

Note the value here is `approved`, not `accepted` — this fixture proves the
value is read CLEANLY, not that `approved` is treated as accepted. Whether
`approved` joins the accepted family is a vocabulary decision, unmapped here.

## Decision

Resolve to the clean token `approved` from the heading source; not accepted.
