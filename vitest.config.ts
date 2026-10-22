import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./tests/mocks/cloudflare-workers.ts", import.meta.url)),
    },
  },
});
