import "server-only";
import type { MemberRole } from "@/platform/db";
import { withCompany, withUser } from "@/platform/tenant";

export type CompanySummary = { id: string; name: string; role: MemberRole };

export async function listCompaniesFor(userId: string): Promise<CompanySummary[]> {
  const memberships = await withUser({ userId }, (tx) =>
    tx.membership.findMany({ where: { userId }, include: { company: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
  );
  return memberships.map((m) => ({ id: m.company.id, name: m.company.name, role: m.role }));
}

/** The company and the user's role in it, or null if the user is not a member (the database decides). */
export async function getCompanyFor(userId: string, companyId: string): Promise<CompanySummary | null> {
  const row = await withCompany({ userId, companyId }, async (tx) => {
    const roles = await tx.$queryRaw<{ role: MemberRole | null }[]>`SELECT app_tenant_role() AS role`;
    const role = roles[0]?.role ?? null;
    if (!role) return null;
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
    return company ? { ...company, role } : null;
  });
  return row;
}
