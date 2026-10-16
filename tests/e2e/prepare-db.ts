import { execFileSync } from "node:child_process";
import pg from "pg";
import { E2E_DB, e2eUrls } from "./db";

/**
 * Fresh database for the browser tests: created from scratch and migrated with the real migration
 * (`prisma migrate deploy` + role bootstrap), so `/setup` starts from an untouched instance.
 * Runs before Playwright (`npm run test:e2e`): Playwright starts its web server before any global setup.
 */
async function prepare(): Promise<void> {
  const urls = e2eUrls();
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${E2E_DB}`);
  await admin.end();

  execFileSync("npm", ["run", "db:migrate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: urls.owner },
  });
}

await prepare();
