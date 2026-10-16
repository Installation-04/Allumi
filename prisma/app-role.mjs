// Idempotent bootstrap of the restricted PostgreSQL roles. Runs after `prisma migrate deploy`,
// on every start of the `migrate` service, with the owner credentials (DATABASE_URL).
//
// Roles are cluster-wide objects and are not part of pg_dump: after a restore on a fresh server
// they are missing, so this script (re)creates them. The privileges themselves live in the
// migration and travel with the dump.
import pg from "pg";

const ownerUrl = process.env.DATABASE_URL;
const appPassword = process.env.APP_DB_PASSWORD;

if (!ownerUrl) {
  console.error("[app-role] DATABASE_URL is missing.");
  process.exit(1);
}
if (!appPassword || appPassword === "CHANGE_ME") {
  console.error("[app-role] APP_DB_PASSWORD is missing or still CHANGE_ME (see .env.example).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  for (const role of ["allumi_app", "allumi_redactor"]) {
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
           CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $$`,
    );
  }
  const { rows } = await client.query("SELECT format('ALTER ROLE allumi_app LOGIN PASSWORD %L', $1::text) AS sql", [
    appPassword,
  ]);
  await client.query(rows[0].sql);

  const check = await client.query(
    "SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'allumi_app'",
  );
  const role = check.rows[0];
  if (role.rolsuper || role.rolbypassrls || !role.rolcanlogin) {
    throw new Error("allumi_app must be a plain login role (not superuser, not BYPASSRLS).");
  }
  console.log("[app-role] allumi_app is ready.");
} finally {
  await client.end();
}
