import { execFileSync } from "node:child_process";
import pg from "pg";

// Overridable so that two runs at the same time (for example two worktrees) do not rebuild the same template.
export const TEMPLATE_DB = process.env.ALLUMI_TEST_TEMPLATE ?? "allumi_test_template";

export function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // CI provides the variables directly
  }
}

function withDatabase(url: string, database: string, credentials?: { user: string; password: string }): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  parsed.search = "";
  if (credentials) {
    parsed.username = credentials.user;
    parsed.password = credentials.password;
  }
  return parsed.toString();
}

export function urlsFor(database: string): { owner: string; app: string; admin: string } {
  loadEnv();
  const owner = process.env.DATABASE_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!owner || !appPassword) {
    throw new Error("DATABASE_URL (owner) and APP_DB_PASSWORD are required for the integration tests (run ./scripts/cloud-setup.sh).");
  }
  return {
    admin: owner,
    owner: withDatabase(owner, database),
    app: withDatabase(owner, database, { user: "allumi_app", password: appPassword }),
  };
}

/** Creates the migrated template once per run; every test file then clones it. */
export async function buildTemplate(): Promise<void> {
  const urls = urlsFor(TEMPLATE_DB);
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();
  execFileSync("npm", ["run", "db:migrate"], { stdio: "pipe", env: { ...process.env, DATABASE_URL: urls.owner } });
}
