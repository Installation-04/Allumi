import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { contactFilterSchema, contactSchema } from "../domain/contact";

const SELECT = { id: true, displayName: true, legalName: true, isCustomer: true, isSupplier: true, email: true, phone: true, addressLine1: true, addressLine2: true, city: true, province: true, postalCode: true, country: true, locale: true, paymentTermsDays: true, notes: true, isActive: true } as const;
export const CONTACT_PAGE_SIZE = 25;

export async function listContacts(actor: CompanyContext, filter: unknown = {}) {
  const parsed = contactFilterSchema.safeParse(filter);
  if (!parsed.success) throw new AppError("contacts.invalidFilter");
  const { q, kind, status, page: requestedPage } = parsed.data;
  // PostgreSQL LIKE wildcards are literal characters in this search box.
  const term = q.replace(/[\\%_]/g, "\\$&");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "contact.read");
    const where = {
      companyId: actor.companyId, anonymizedAt: null,
      ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
      ...(kind === "CUSTOMER" ? { isCustomer: true } : kind === "SUPPLIER" ? { isSupplier: true } : {}),
      ...(term ? { OR: ["displayName", "legalName", "email", "phone"].map((field) => ({ [field]: { contains: term, mode: "insensitive" as const } })) } : {}),
    };
    const total = await tx.contact.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / CONTACT_PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const contacts = await tx.contact.findMany({ where, select: SELECT, orderBy: [{ displayName: "asc" }, { id: "asc" }], skip: (page - 1) * CONTACT_PAGE_SIZE, take: CONTACT_PAGE_SIZE });
    return { contacts, total, page, pageCount };
  });
}

export async function getContact(actor: CompanyContext, id: string) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "contact.read");
    return tx.contact.findFirst({ where: { id, companyId: actor.companyId, anonymizedAt: null }, select: SELECT });
  });
}
export type ContactDto = NonNullable<Awaited<ReturnType<typeof getContact>>>;

export async function saveContact(actor: CompanyContext, input: unknown, id?: string): Promise<ContactDto> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) throw new AppError("contacts.invalid");
  const { kind, ...values } = parsed.data;
  const data = { ...values, isCustomer: kind !== "SUPPLIER", isSupplier: kind !== "CUSTOMER" };
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "contact.manage");
    if (!id) return tx.contact.create({ data: { companyId: actor.companyId, ...data }, select: SELECT });
    // An anonymized contact must never be repopulated through the regular editing form.
    const result = await tx.contact.updateMany({ where: { id, companyId: actor.companyId, anonymizedAt: null }, data });
    if (result.count !== 1) throw new AppError("contacts.notFound");
    return tx.contact.findUniqueOrThrow({ where: { companyId_id: { companyId: actor.companyId, id } }, select: SELECT });
  });
}

/** Archive/restore without deleting the identity used by accounting documents. Database triggers record the audit. */
export async function setContactActive(actor: CompanyContext, id: string, active: boolean) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "contact.manage");
    const result = await tx.contact.updateMany({ where: { id, companyId: actor.companyId, anonymizedAt: null }, data: { isActive: active } });
    if (result.count !== 1) throw new AppError("contacts.notFound");
  });
}
