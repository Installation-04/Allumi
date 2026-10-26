import "server-only";
import { z } from "zod";
import { newToken, sha256Hex } from "@/modules/auth";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { MODULES, moduleLevel, type ModuleAccess } from "../domain/module-access";
import { requireRole } from "./access";

export const MEMBER_ROLES = ["OWNER", "USER", "READ_ONLY", "ACCOUNTANT"] as const;
const roleSchema = z.enum(MEMBER_ROLES);
const moduleSchema = z.partialRecord(z.enum(MODULES), z.enum(["none", "read", "write"]));
const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: roleSchema, moduleAccess: moduleSchema.default({}) });
const idSchema = z.string().uuid();

async function lock(tx: Tx) {
  await requireRole(tx, "members.manage");
  await tx.$queryRaw`SELECT id FROM company WHERE id = app_tenant_id() FOR UPDATE`;
  // Recheck after the lock: another administrator may have removed this actor while it waited.
  await requireRole(tx, "members.manage");
}
export function listMembers(actor: CompanyContext) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "members.manage");
    const members = await tx.membership.findMany({ where: { companyId: actor.companyId }, select: { id: true, userId: true, role: true, moduleAccess: true, user: { select: { displayName: true, email: true, disabledAt: true, canManageServer: true, isInstanceAdmin: true } } }, orderBy: { createdAt: "asc" } });
    const invitations = await tx.invitation.findMany({ where: { companyId: actor.companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, role: true, moduleAccess: true, expiresAt: true }, orderBy: { createdAt: "desc" } });
    return { members, invitations };
  });
}
export async function inviteMember(actor: CompanyContext, input: unknown) {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) throw new AppError("members.invalid");
  validateModules(parsed.data.role, parsed.data.moduleAccess);
  const token = newToken();
  await withCompany(actor, async tx => {
    await lock(tx);
    if (await tx.membership.findFirst({ where: { companyId: actor.companyId, user: { email: parsed.data.email } } })) throw new AppError("members.exists");
    // Replacing an invitation invalidates all earlier codes for this address in this company.
    await tx.invitation.updateMany({ where: { companyId: actor.companyId, email: parsed.data.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.invitation.create({ data: { ...parsed.data, companyId: actor.companyId, createdById: actor.userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 7 * 86400_000) } });
  });
  return token;
}
export async function changeMemberRole(actor: CompanyContext, id: string, role: unknown, moduleAccess: unknown = {}) {
  const parsed = roleSchema.safeParse(role);
  if (!idSchema.safeParse(id).success || !parsed.success) throw new AppError("members.invalid");
  const permissionInput = moduleSchema.safeParse(moduleAccess);
  if (!permissionInput.success) throw new AppError("members.invalid");
  const access = permissionInput.data;
  validateModules(parsed.data, access);
  await withCompany(actor, async tx => {
    await lock(tx);
    const member = await tx.membership.findFirst({ where: { id, companyId: actor.companyId } });
    if (!member) throw new AppError("members.notFound");
    if (member.userId === actor.userId) throw new AppError("members.self");
    await tx.membership.update({ where: { id }, data: { role: parsed.data, moduleAccess: access } });
    if (member.role === "OWNER" && parsed.data !== "OWNER") await tx.invitation.updateMany({ where: { companyId: actor.companyId, createdById: member.userId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}
export async function removeMember(actor: CompanyContext, id: string) {
  if (!idSchema.safeParse(id).success) throw new AppError("members.invalid");
  await withCompany(actor, async tx => {
    await lock(tx);
    const member = await tx.membership.findFirst({ where: { id, companyId: actor.companyId } });
    if (!member) throw new AppError("members.notFound");
    if (member.userId === actor.userId) throw new AppError("members.self");
    await tx.membership.delete({ where: { id } });
    await tx.invitation.updateMany({ where: { companyId: actor.companyId, createdById: member.userId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}
export async function revokeInvitation(actor: CompanyContext, id: string) {
  if (!idSchema.safeParse(id).success) throw new AppError("members.invalid");
  await withCompany(actor, async tx => {
    await lock(tx);
    const result = await tx.invitation.updateMany({ where: { id, companyId: actor.companyId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (result.count !== 1) throw new AppError("members.notFound");
  });
}

function validateModules(role: typeof MEMBER_ROLES[number], moduleAccess: ModuleAccess) {
  const level = (module: typeof MODULES[number]) => moduleLevel({ role, moduleAccess }, module);
  if ((level("sales") !== "none" && ["contacts", "catalog", "accounting", "taxes"].some(m => level(m as typeof MODULES[number]) === "none")) ||
      (level("sales") === "write" && level("accounting") !== "write") ||
      (level("catalog") !== "none" && (level("accounting") === "none" || level("taxes") === "none")) ||
      (level("taxes") !== "none" && level("accounting") === "none") ||
      (level("audit") !== "none" && MODULES.some(m => m !== "audit" && level(m) === "none"))) throw new AppError("members.dependencies");
}
