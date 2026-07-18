// Fake claude CLI (test harness, ADR-0044 taxonomy proof): prints the sibling
// failure envelope and exits 1, the measured auth-failure shape.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.stdout.write(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "payload.json"), "utf-8"));
process.exit(1);
