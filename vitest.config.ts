import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    env: { DOTENV_CONFIG_PATH: ".env.test" },
    hookTimeout: 30000,
    testTimeout: 30000,
    // These tests share one local database and truncate between files, so
    // they must never run in parallel.
    fileParallelism: false,
  },
});
