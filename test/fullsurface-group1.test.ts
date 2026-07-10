import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSingleCheck } from "./helpers/run-checks.js";
import { loadConfig } from "../src/config/load.js";
import { renderMarkdownReport } from "../src/report/write.js";

// Full-surface adversarial pass — GROUP 1 (primitive consolidation). Each fix
// routes a primitive that had drifted into some checks and not others through
// its one shared implementation; each fixture runs the engine, red on 5d0e449.

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "fixtures", ".tmp-fullsurface-g1");

function writeRepo(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(TMP, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return TMP;
}

const adr = (n: string, body = "x") =>
  `---\nstatus: accepted\n---\n\n# ADR-${n}\n\n## Context\n${body}\n\n## Decision\ny\n\n## Consequences\nz\n`;
const supersededAdr = (n: string) =>
  `---\nstatus: superseded\nsuperseded-by: 0009\n---\n\n# ADR-${n}\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`;

const d2 = (dir: string) => runSingleCheck(dir, "D2").filter((f) => f.check === "D2");
const d4 = (dir: string) => runSingleCheck(dir, "D4").filter((f) => f.check === "D4");
const d7 = (dir: string) => runSingleCheck(dir, "D7").filter((f) => f.check === "D7");

describe("GROUP 1 — primitive consolidation", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("B-1: an external `.md` URL in the index is skipped like an external link, not reconciled", () => {
    // The `.md$` filter passed `https://…/style.md` and D7 reconciled it against
    // the directory → "the index lists …/style.md, which does not exist," exit 1.
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      "docs/adr/README.md": "# Index\n\n- [ADR 1](0001-a.md)\n- [guide](https://example.com/style.md)\n",
    });
    expect(d7(dir)).toEqual([]);
  });

  it("B-2: an extensionless site-relative entry resolves — the ADR it lists is not falsely 'not listed'", () => {
    // `[ADR 2](0002-b)` was excluded by the `.md$` filter, so 0002-b.md was
    // reported "exists but is not listed in the ADR index," exit 1.
    const dir = writeRepo({
      "docs/adr/0001-a.md": adr("0001"),
      "docs/adr/0002-b.md": adr("0002"),
      "docs/adr/README.md": "# Index\n\n- [ADR 1](0001-a.md)\n- [ADR 2](0002-b)\n",
    });
    expect(d7(dir)).toEqual([]);
  });

  it("B-8: a ghost reference in a sibling directory sharing a name prefix is scanned (not startsWith-skipped)", () => {
    // `docs/adr-extra/`.startsWith(`docs/adr`) wrongly excluded the sibling dir
    // from D4's out-of-log scan, so a stale citation there produced no advisory.
    const dir = writeRepo({
      "docs/adr/0001-a.md": supersededAdr("0001"),
      "docs/adr-extra/ref.md": "Implementation still follows ADR-0001 for session handling.\n",
    });
    const claims = d4(dir).map((f) => f.claim);
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain("adr-extra/ref.md");
    expect(claims[0]).toContain("ADR-0001");
  });

  it("B-9: a backtick+link payload in a supersession path is fenced, not rendered as a live link", () => {
    // D2:140 open-coded `` `${kind}: ${path}` `` where `path` is ADR-authored, so
    // a value that closes the span injects markdown into the report/job summary.
    const dir = writeRepo({
      "docs/adr/0001-a.md":
        '---\nstatus: accepted\nsuperseded-by: "`[x](https://evil.example)"\n---\n\n# ADR-0001\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n',
    });
    const broken = d2(dir).filter((f) => /does not resolve to an ADR/.test(f.claim));
    expect(broken.length).toBe(1);
    // Behavioral: render the report, strip inline code spans, and assert the
    // payload's link is inert — it survives only as literal code, never as a live
    // `](url)` in the rendered (non-code) text.
    const residue = stripInlineCode(renderMarkdownReport(broken));
    expect(residue).not.toContain("](https://evil.example)");
  });
});

describe("B-10 — the file-size cap applies to the config read", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("an oversized .duckadrift.yml is ignored (bounded), not read and parsed", () => {
    // The 2MB walk cap did not cover config/load.ts's readFileSync, so a large
    // (fork-authorable) config was read uncapped — an OOM at V8's string limit.
    // The cap now short-circuits before the read: an oversized config yields
    // defaults, provably (a declared dialect inside it is not adopted).
    const oversized = `dialect: madr\n# ${"padding ".repeat(300_000)}\n`; // ~2.4MB > 2MB cap
    const dir = writeRepo({ ".duckadrift.yml": oversized });
    // Full defaults — no dialect adopted, tier1 at its always-populated default (ADR-0029).
    expect(loadConfig(dir)).toEqual({
      tier1: { enabled: false, backend: "api", model: "claude-sonnet-5", effort: "high" },
    });
  });
});

// A minimal inline-code-span stripper: remove each ``…`` run (fence of N
// backticks, closed by the next run of N), leaving only the non-code text. Good
// enough to prove a payload rendered as literal code, not as a live `](url)`.
function stripInlineCode(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "`") {
      let n = 0;
      while (s[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const close = s.indexOf(fence, i + n);
      if (close !== -1) {
        i = close + n;
        continue;
      }
      out += fence;
      i += n;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}
