import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["build/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/helpers.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
