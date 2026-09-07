import { defineConfig } from "vitest/config";

// The adversarial ledger. These tests are expected to fail while their findings are open,
// so they are kept out of the default run and CI.
export default defineConfig({
  test: {
    include: ["findings/**/*.test.ts", "findings/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
});
