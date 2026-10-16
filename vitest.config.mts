import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["tests/e2e/playwright/**", "node_modules/**", "dist/**"],
  },
});
