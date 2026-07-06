import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@media-app/shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
