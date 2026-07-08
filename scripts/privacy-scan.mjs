#!/usr/bin/env node
// privacy-scan.mjs — one scanner, used by the local pre-commit hook and the CI guard.
// Names never appear in this file: the denylist is read from a path (a gitignored local
// file for the hook, a secret-materialized temp file for CI). The allowlist is committed.
// Usage: node privacy-scan.mjs --names <denylist> [--allow <allowlist>] [--ci] <file>...
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
let namesPath = null, allowPath = ".privacy-allowlist", ci = false;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--names") namesPath = args[++i];
  else if (args[i] === "--allow") allowPath = args[++i];
  else if (args[i] === "--ci") ci = true;
  else if (args[i] === "--from") { const fl = args[++i]; try { readFileSync(fl,"utf8").split("\n").map(x=>x.trim()).filter(Boolean).forEach(x=>files.push(x)); } catch { console.error(`privacy-scan: cannot read file-list ${fl}`); process.exit(2); } }
  else files.push(args[i]);
}
const load = (p, req) => {
  try { return readFileSync(p, "utf8").split("\n").map(l => l.trim())
    .filter(l => l && !l.startsWith("#")); }
  catch { if (req) { console.error(`privacy-scan: cannot read ${p}`); process.exit(2); } return []; }
};
if (!namesPath) { console.error("privacy-scan: --names <file> required"); process.exit(2); }
const deny = load(namesPath, true).map(s => s.toLowerCase());
const allow = new Set(load(allowPath, false).map(s => s.toLowerCase()));
const active = deny.filter(n => !allow.has(n));            // allowlist removes entries
for (const n of active) if (n.length < 4)                  // guard against FP-storm short entries
  console.error(`privacy-scan: WARNING denylist entry "${ci?"<redacted>":n}" is <4 chars; may over-match`);
if (active.length === 0) { process.exit(0); }

let hits = 0;
for (const f of files) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    const lc = line.toLowerCase();
    for (const n of active) if (lc.includes(n)) {          // case-insensitive substring: catches glued/variant forms
      hits++;
      console.error(`  ${f}:${idx + 1}: forbidden name ${ci ? "<redacted>" : `"${n}"`}`);
      break;
    }
  });
}
if (hits) { console.error(`privacy-scan: ${hits} forbidden-name occurrence(s) — blocked.`); process.exit(1); }
process.exit(0);
