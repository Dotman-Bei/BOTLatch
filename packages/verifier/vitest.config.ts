import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The pipeline is pure computation with a stubbed fetch; nothing here should be slow.
    testTimeout: 10_000,
  },
});
