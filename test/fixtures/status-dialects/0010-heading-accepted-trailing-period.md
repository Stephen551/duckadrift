# ADR-0010: Heading-declared accepted with a trailing period

## Status

Accepted.

## Context

cosmos-sdk's real shape: a `## Status` heading whose value ends in a period.
Three genuinely accepted cosmos ADRs were missed when the period leaked into the
token as `accepted.`.

## Decision

Resolve to accepted from the heading source; the trailing period is stripped.
