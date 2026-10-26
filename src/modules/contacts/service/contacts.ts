import "server-only";
import { recordEvent } from "@/modules/audit";
import { totpStatus, verifySecondFactor } from "@/modules/auth";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { ANONYMIZED_NAME, PERSONAL_COLUMNS, anonymizeSchema, contactFilterSchema, contactSchema } from "../domain/contact";

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

/** The proof that the owner is there right now: a fresh code of their authenticator (or a recovery code). */
export type AnonymizeProof = { code: string; now?: Date };

/**
 * Law 25 erasure of a contact: owner only, two-factor authentication on and a code typed now (a session cookie alone is
 * not enough for something irreversible), a reason from a fixed list, all in one transaction:
 *
 *  1. the personal columns are cleared and the contact is marked anonymized (it disappears from lists and forms; the
 *     row stays, so the accounting documents that point to it stay valid);
 *  2. the database function `audit_redact` (owner only, its own role) removes those same keys from every audit entry
 *     of the contact, including the entry the clearing has just written; it logs `privacy.redact` itself;
 *  3. `contact.anonymize` records who did it and why, with no personal data.
 *
 * Posted invoices keep their own frozen copy of the customer's details: accounting records must be retained.
 *
 * The cheap checks come first and the code last, right before the change: a code is spent only by an anonymization
 * that is going to happen, not by a stale form.
 */
export async function anonymizeContact(actor: CompanyContext, id: string, input: unknown, proof: AnonymizeProof): Promise<{ redactedRows: number }> {
  const parsed = anonymizeSchema.safeParse(input);
  if (!parsed.success) throw new AppError("contacts.anonymizeInvalid");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "contact.anonymize");
    if (!(await totpStatus(actor.userId)).enabled) throw new AppError("contacts.twoFactorRequired");
    if (!(await tx.contact.findFirst({ where: { id, companyId: actor.companyId, anonymizedAt: null }, select: { id: true } }))) throw new AppError("contacts.notFound");
    const verdict = await verifySecondFactor(actor.userId, proof.code, proof.now);
    if (verdict === "rate_limited") throw new AppError("contacts.rateLimited");
    if (verdict !== "ok") throw new AppError("contacts.codeInvalid");

    const cleared = await tx.contact.updateMany({
      where: { id, companyId: actor.companyId, anonymizedAt: null },
      data: {
        displayName: ANONYMIZED_NAME, legalName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null,
        province: null, postalCode: null, notes: null, gstNumber: null, qstNumber: null, taxExemptionNumber: null,
        isActive: false, anonymizedAt: new Date(),
      },
    });
    if (cleared.count !== 1) throw new AppError("contacts.notFound");
    const [redacted] = await tx.$queryRaw<{ n: number }[]>`SELECT audit_redact('contact', ${id}, ${[...PERSONAL_COLUMNS]}::text[]) AS n`;
    await recordEvent(tx, { action: "contact.anonymize", entityType: "contact", entityId: id, data: { reason: parsed.data.reason } });
    return { redactedRows: redacted?.n ?? 0 };
  });
}
