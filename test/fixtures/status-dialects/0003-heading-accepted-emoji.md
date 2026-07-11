# ADR-0003: Heading-declared accepted with a leading symbol

## Status

✅ Accepted

## Context

Some logs decorate the status value with a leading symbol (cloud-platform's
`✅ Accepted`). The decoration is stripped before the status token is read.

## Decision

Resolve to accepted from the heading source.
