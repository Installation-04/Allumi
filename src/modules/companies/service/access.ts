import "server-only";
import { AppError } from "@/platform/errors";
import type { Tx } from "@/platform/tenant";
import { can, type Action, type Role } from "../domain/permissions";

/**
 * The caller's role in the company of the current transaction, or a refusal. The database already refuses
 * what a role may not do (row level security); this gives the user a clear message before any work is done.
 */
export async function requireRole(tx: Tx, action: Action): Promise<Role> {
  const rows = await tx.$queryRaw<{ role: Role | null }[]>`SELECT app_tenant_role()::text AS role`;
  const role = rows[0]?.role ?? null;
  if (!role || !can(role, action)) throw new AppError("forbidden");
  return role;
}
