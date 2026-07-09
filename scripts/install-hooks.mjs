#!/usr/bin/env node
// Runs from npm's "prepare" script so a fresh clone gets the versioned hooks in hooks/
// activated (core.hooksPath) by the `npm ci` every contributor already runs.
//
// THIS RUNS ON THE ADOPTER PATH: action.yml's Build step does `npm ci` inside the
// action checkout on every adopter's runner, and a failing prepare would break the
// action for every adopter. So this script MUST never fail and MUST never touch a repo
// that is not this one: it only acts when (a) the current directory is itself the
// toplevel of a git work tree, and (b) that tree contains hooks/pre-commit. In the
// runner-tarball case there is no .git and this is a silent no-op; in the dogfood-CI
// case it sets hooksPath in a throwaway clone, which is harmless.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

try {
  const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (resolve(toplevel) !== resolve(process.cwd())) process.exit(0);
  if (!existsSync(resolve(toplevel, "hooks", "pre-commit"))) process.exit(0);
  execFileSync("git", ["config", "core.hooksPath", "hooks"], { stdio: "ignore" });
} catch {
  // Not a git repo, git absent, or config not writable — all fine. Never fail an install.
}
process.exit(0);
