/**
 * Author: Xiaotian Lou
 * Date: 2026-03-04
 * Purpose: Vitest configuration for running shared module unit tests with V8 coverage.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      // Exclude pure type-definition files that have no runtime coverage
      exclude: ["src/index.ts", "src/validation/types.ts"],
    },
  },
});
