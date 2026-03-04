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
      exclude: [
        "src/index.ts",
        "src/app.ts",
        "src/firebase.ts",
        "src/routes/**",
        "src/services/projects.ts",
        "src/services/image.ts",
        "src/services/masks.ts",
      ],
    },
  },
});
