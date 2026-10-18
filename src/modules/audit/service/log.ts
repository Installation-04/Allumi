import "server-only";
import { requireRole } from "@/modules/companies";
import { withCompany } from "@/platform/tenant";

export type AuditEntryDto = {
  id: string;
  occurredAt: Date;
  actorKind: "USER" | "SYSTEM";
  /** The user's id, kept in the trail even once the person is no longer a member (their name is then not visible). */
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

export type AuditFilter = {
  entityType?: string;
  entityId?: string;
  /** Matches the start of the action, e.g. `period.` or `row.insert`. */
  action?: string;
  actorUserId?: string;
  /** Page cursor: the id of the last entry of the previous page. */
  before?: string;
};

export const AUDIT_PAGE_SIZE = 50;

/** The company's audit trail, newest first. Owners and accountants only (the database refuses read-only members too). */
export async function listAuditLog(
  actor: { userId: string; companyId: string },
  filter: AuditFilter = {},
): Promise<{ entries: AuditEntryDto[]; nextCursor: string | null }> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "audit.read");
    const cursor = filter.before && /^\d{1,18}$/.test(filter.before) ? BigInt(filter.before) : undefined;
    const rows = await tx.auditLog.findMany({
      where: {
        companyId: actor.companyId,
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.action ? { action: { startsWith: filter.action } } : {}),
        ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
        ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
      },
      include: { actorUser: { select: { displayName: true } } },
      orderBy: { id: "desc" },
      take: AUDIT_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    return {
      entries: page.map((row) => ({
        id: row.id.toString(),
        occurredAt: row.occurredAt,
        actorKind: row.actorKind,
        actorUserId: row.actorUserId,
        actorName: row.actorUser?.displayName ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
      })),
      nextCursor: rows.length > AUDIT_PAGE_SIZE ? (page[page.length - 1]?.id.toString() ?? null) : null,
    };
  });
}
