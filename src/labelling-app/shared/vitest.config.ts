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
