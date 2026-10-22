import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // the DB tests share one MySQL schema, and their cleanup DELETEs deadlock with
    // each other's inserts when files run side by side
    fileParallelism: false
  }
});
