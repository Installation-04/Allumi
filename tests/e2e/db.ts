// Database used by the browser tests, derived from the development .env (or the CI variables).
export const E2E_DB = "allumi_e2e";

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

export function e2eUrls(): { owner: string; app: string; admin: string } {
  loadEnv();
  const owner = process.env.DATABASE_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!owner || !appPassword) throw new Error("DATABASE_URL and APP_DB_PASSWORD are required for the e2e tests.");
  return {
    admin: owner,
    owner: withDatabase(owner, E2E_DB),
    app: withDatabase(owner, E2E_DB, { user: "allumi_app", password: appPassword }),
  };
}
