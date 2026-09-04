import { defineConfig } from "vitest/config";
import path from "node:path";

// Alias workspace packages to their TS source rather than built `dist/`
// output, so tests reflect the code under test without a build step
// in between (dist/ is still what gets published/shipped).
const pkgs = [
  "shared",
  "crypto",
  "challenges",
  "risk-engine",
  "rate-limit",
  "captcha-client",
  "captcha-server",
];

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20000,
  },
  resolve: {
    alias: Object.fromEntries(
      pkgs.map((p) => [`@gatekeeper/${p}`, path.resolve(__dirname, `packages/${p}/src/index.ts`)]),
    ),
  },
});
