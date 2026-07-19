// Fake claude CLI (ADR-0046 red corpus, attack 4): echoes its own working
// directory back through the envelope. The transport runs each send with the
// per-send scratch dir as the child's cwd, so `process.cwd()` here IS the
// scratch dir the transport chose. The test reads it back and asserts it
// resolves outside the scanned repository, whatever the temp-dir environment
// says. A base envelope is loaded for the success shape; only structured_output
// is rewritten so the observed cwd survives extraction into the result.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const base = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "payload.json"), "utf-8"));
base.structured_output = { findings: [{ observedCwd: process.cwd() }] };
process.stdout.write(JSON.stringify(base));
process.exit(0);
