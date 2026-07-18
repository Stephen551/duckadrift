// Fake claude CLI (test harness, ADR-0044 taxonomy proof): prints the sibling
// payload verbatim and exits 0, the measured success shape.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.stdout.write(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "payload.json"), "utf-8"));
process.exit(0);
