import { defineConfig, devices } from "@playwright/test";
import { e2eUrls } from "./tests/e2e/db";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const urls = e2eUrls();

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    locale: "fr-CA",
    launchOptions: {
      // Locally and in cloud sessions Chromium is preinstalled; elsewhere Playwright downloads its own.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Needs `npm run build` first. Same artifact as the Docker image: the standalone server, with its static
    // assets copied next to it, run from a directory OUTSIDE the repository so that a traced dependency missing
    // from the standalone bundle cannot be found in the project's own node_modules (as in the image).
    command:
      "D=${TMPDIR:-/tmp}/allumi-e2e-standalone && rm -rf $D && mkdir -p $D && cp -r .next/standalone/. $D/ && " +
      "cp -r .next/static $D/.next/static && cp -r public $D/public && cd $D && node server.js",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      HOSTNAME: "127.0.0.1",
      PORT: String(PORT),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      APP_URL: `http://127.0.0.1:${PORT}`,
      APP_DATABASE_URL: urls.app,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      LOG_LEVEL: "warn",
      // The journey is written for a plain French instance: a developer's .env must not change it.
      SETUP_TOKEN: "",
      DEFAULT_LOCALE: "fr-CA",
      APP_VERSION: "",
      TRUSTED_PROXY_HOPS: "1",
    },
  },
});
