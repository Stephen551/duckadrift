import { defineConfig } from "vitest/config";

// The quarantined security red corpus (ADR-0046, Stage 0). These tests assert
// the SECURE behavior of a defense the milestone has not built yet, so they
// fail on purpose against the current tree. They live in `*.redtest.ts` files,
// which the gate config (vitest.config.ts, include `test/**/*.test.ts`) does
// not match, so `npm test` stays green while the reds stand as a committed
// specification. Run them explicitly:
//
//   npx vitest run --config vitest.redcorpus.config.ts
//
// Each later stage promotes a red by moving its `describe` into the sibling
// `*.test.ts` file that owns the seam, where it turns green once the fix lands.
// When the last red is promoted, this config and its `*.redtest.ts` files are
// deleted.
export default defineConfig({
  test: {
    include: ["test/**/*.redtest.ts"],
  },
});
