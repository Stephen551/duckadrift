---
status: accepted
date: 2026-03-03
---

# ADR-0001: The appliance is self-contained — file-local persistence, nothing listening

## Status

Accepted — 2026-03-03

## Context

The product installs on customer hardware that operators administer rarely and
patch reluctantly. Every additional running service is another thing to secure,
monitor, and explain during procurement review.

## Decision

All persistence lives in the embedded SQLite file that ships inside the install
directory. The deploy target runs no network services: nothing listens on any
port, and the application opens no connections to other processes.

## Consequences

Backup is copying one file. Horizontal scaling is out of scope by design; a
customer who outgrows a single box is a different product conversation.
