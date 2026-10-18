import "server-only";
import { env } from "./env";
import { prisma } from "./db";
import { logger } from "./logger";

/**
 * Fails fast on a bad configuration. Called once when the server starts (instrumentation.ts).
 * Never asks the database anything beyond its own role.
 */
export async function assertStartup(): Promise<void> {
  env(); // throws one readable message listing every invalid variable

  const rows = await prisma().$queryRaw<{ current_user: string; privileged: boolean }[]>`
    SELECT current_user, (rolsuper OR rolbypassrls) AS privileged FROM pg_roles WHERE rolname = current_user`;
  const role = rows[0];
  if (!role || role.privileged) {
    throw new Error(
      `The application must connect with the restricted allumi_app role, not "${role?.current_user ?? "unknown"}" ` +
        "(superuser or BYPASSRLS would disable the tenant isolation). Check APP_DATABASE_URL.",
    );
  }
  logger.info({ dbRole: role.current_user }, "allumi started");
}
