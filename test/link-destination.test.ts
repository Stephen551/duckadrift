import { describe, expect, it } from "vitest";
import { normalizeLinkDestination } from "../src/adr/parse.js";

// Workstream A (v0.1.5 adversarial consolidation): the CommonMark destination
// normalizer that both D3 (via parsed.links) and D7 (via extractLinkTargets)
// now share. This is the exact contract from the handoff — angle brackets
// unwrapped, whitespace-separated titles dropped, balanced parens in a filename
// kept, fragment stripped.

describe("normalizeLinkDestination: CommonMark destination -> resolvable path", () => {
  const cases: Array<[string, string]> = [
    ["<http://example.com>", "http://example.com"],
    ["<../design notes/auth design.md>", "../design notes/auth design.md"],
    ['../src/worker.ts "Worker entrypoint"', "../src/worker.ts"],
    ["../src/worker.ts 'entrypoint'", "../src/worker.ts"],
    ["client(v2).ts", "client(v2).ts"],
    ["./0001-foo.md#section", "./0001-foo.md"],
    ["path", "path"],
  ];
  for (const [raw, expected] of cases) {
    it(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, () => {
      expect(normalizeLinkDestination(raw)).toBe(expected);
    });
  }

  it("leaves surrounding whitespace out of the result", () => {
    expect(normalizeLinkDestination("  path  ")).toBe("path");
  });

  it("drops a parenthesized title separated by whitespace", () => {
    // Balanced parens WITH preceding whitespace are a title, not part of the path.
    expect(normalizeLinkDestination("worker.ts (the entrypoint)")).toBe("worker.ts");
  });

  // Regression: the title-strip must stay LINEAR. The first cut used
  // `/\s+(...)\s*$/`, which is O(n^2) on a long internal whitespace run followed
  // by an unterminated title token — a fork-PR resource-exhaustion vector, since
  // untrusted ADR body/index content reaches this (S6/ADR-0013 class). The
  // linear implementation clears a 200k-char adversarial input in well under a
  // bound the quadratic version (minutes) could never meet.
  it("handles an adversarial whitespace+unterminated-title input in bounded time", () => {
    const evil = `path${" ".repeat(200_000)}"unterminated`;
    const start = performance.now();
    const out = normalizeLinkDestination(evil);
    const elapsedMs = performance.now() - start;
    expect(out).toBe(evil); // no trailing title -> unchanged
    expect(elapsedMs).toBeLessThan(250);
  });
});
