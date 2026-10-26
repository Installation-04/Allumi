import "server-only";
import { AppError } from "@/platform/errors";
import type { Tx } from "@/platform/tenant";
import { can, type Action, type Role } from "../domain/permissions";

/**
 * The caller's role in the company of the current transaction, or a refusal. The database already refuses
 * what a role may not do (row level security); this gives the user a clear message before any work is done.
 */
export async function requireRole(tx: Tx, action: Action): Promise<Role> {
  const rows = await tx.$queryRaw<{ role: Role | null; moduleAccess: unknown }[]>`SELECT app_tenant_role()::text AS role, (SELECT module_access FROM membership WHERE company_id=app_tenant_id() AND user_id=app_current_user_id()) AS "moduleAccess"`;
  const row = rows[0];
  if (!row?.role || !can({ role: row.role, moduleAccess: row.moduleAccess }, action)) throw new AppError("forbidden");
  return row.role;
}
