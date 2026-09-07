import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // findings/ holds adversarial detection tests that are meant to fail while their
    // finding is open; run them with vitest.findings.config.ts, never in CI.
    exclude: ["node_modules/**", "dist/**", "findings/**"],
    setupFiles: ["./tests/setup.ts"],
  },
});
