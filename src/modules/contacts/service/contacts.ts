import "server-only";
import { requireRole } from "@/modules/companies";
import { inCompany, type Actor } from "@/platform/company";
import { likeText } from "@/platform/search";
import { AppError, prismaErrorCode } from "@/platform/errors";
import { CONTACT_PERSONAL_COLUMNS, contactInputSchema, type ContactFilter, type ContactInput } from "../domain/contact";

export const CONTACTS_PER_PAGE = 25;

export type ContactDto = {
  id: string;
  isCustomer: boolean;
  isSupplier: boolean;
  displayName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  locale: "fr_CA" | "en";
  defaultTaxCodeId: string | null;
  paymentTermsDays: number;
  gstNumber: string | null;
  qstNumber: string | null;
  taxExemptionNumber: string | null;
  notes: string | null;
  isActive: boolean;
  anonymized: boolean;
};

type ContactRow = Omit<ContactDto, "anonymized" | "locale"> & { locale: "fr_CA" | "en"; anonymizedAt: Date | null };

const toDto = ({ anonymizedAt, ...row }: ContactRow): ContactDto => ({ ...row, anonymized: anonymizedAt !== null });

export type ContactList = { contacts: ContactDto[]; total: number; page: number; pageCount: number };

export async function listContacts(
  actor: Actor,
  options: { search?: string; filter?: ContactFilter; includeInactive?: boolean; page?: number } = {},
): Promise<ContactList> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "contact.read");
    const search = options.search?.trim();
    const where = {
      companyId: actor.companyId,
      ...(options.includeInactive ? {} : { isActive: true }),
      ...(options.filter === "customers" ? { isCustomer: true } : options.filter === "suppliers" ? { isSupplier: true } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: likeText(search), mode: "insensitive" as const } },
              { legalName: { contains: likeText(search), mode: "insensitive" as const } },
              { email: { contains: likeText(search), mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const total = await tx.contact.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / CONTACTS_PER_PAGE));
    const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1) || 1), pageCount);
    const rows = await tx.contact.findMany({ where, orderBy: [{ displayName: "asc" }, { id: "asc" }], skip: (page - 1) * CONTACTS_PER_PAGE, take: CONTACTS_PER_PAGE });
    return { contacts: rows.map((row) => toDto(row as ContactRow)), total, page, pageCount };
  });
}

export async function getContact(actor: Actor, contactId: string): Promise<ContactDto | null> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "contact.read");
    const row = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: contactId } });
    return row ? toDto(row as ContactRow) : null;
  });
}

/** The default tax code of a contact must be one of the company's own. */
async function checkTaxCode(tx: Parameters<Parameters<typeof inCompany>[1]>[0], companyId: string, taxCodeId: string | null): Promise<void> {
  if (taxCodeId && !(await tx.taxCode.findFirst({ where: { companyId, id: taxCodeId }, select: { id: true } }))) throw new AppError("contacts.taxCodeNotFound");
}

export async function createContact(actor: Actor, input: ContactInput): Promise<ContactDto> {
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(invalidKey(parsed.error.issues[0]?.path[0]));
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "contact.manage");
    await checkTaxCode(tx, actor.companyId, parsed.data.defaultTaxCodeId);
    const row = await tx.contact.create({ data: { companyId: actor.companyId, ...parsed.data } });
    return toDto(row as ContactRow);
  });
}

export async function updateContact(actor: Actor, contactId: string, input: ContactInput): Promise<ContactDto> {
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(invalidKey(parsed.error.issues[0]?.path[0]));
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "contact.manage");
    const current = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: contactId }, select: { anonymizedAt: true } });
    if (!current) throw new AppError("contacts.notFound");
    if (current.anonymizedAt) throw new AppError("contacts.anonymized");
    await checkTaxCode(tx, actor.companyId, parsed.data.defaultTaxCodeId);
    const row = await tx.contact.update({ where: { companyId_id: { companyId: actor.companyId, id: contactId } }, data: parsed.data });
    return toDto(row as ContactRow);
  });
}

/** A contact with documents is deactivated, not deleted: it stays in the books and out of the lists of choice. */
export async function setContactActive(actor: Actor, contactId: string, active: boolean): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "contact.manage");
    const current = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: contactId }, select: { anonymizedAt: true } });
    if (!current) throw new AppError("contacts.notFound");
    if (current.anonymizedAt) throw new AppError("contacts.anonymized");
    await tx.contact.update({ where: { companyId_id: { companyId: actor.companyId, id: contactId } }, data: { isActive: active } });
  });
}

/** Only a contact that nothing refers to can go. */
export async function deleteContact(actor: Actor, contactId: string): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "contact.manage");
    const current = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: contactId }, select: { id: true } });
    if (!current) throw new AppError("contacts.notFound");
    try {
      await tx.contact.delete({ where: { companyId_id: { companyId: actor.companyId, id: contactId } } });
    } catch (error) {
      if (prismaErrorCode(error) === "P2003" || prismaErrorCode(error) === "P2014") throw new AppError("contacts.inUse");
      throw error;
    }
  });
}

/**
 * Erases the personal data of a contact for good (Law 25: the person asks to be forgotten, the accounting documents stay).
 * The name, the details, the registration numbers and the notes are replaced or removed, the contact is deactivated, and the
 * same fields are redacted from the audit trail of that contact. Owner only. The documents keep the name they were issued to,
 * as the law on keeping accounting records requires.
 */
export async function anonymizeContact(actor: Actor, contactId: string, options: { now?: Date } = {}): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "contact.anonymize");
    const current = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: contactId }, select: { id: true, anonymizedAt: true } });
    if (!current) throw new AppError("contacts.notFound");
    if (current.anonymizedAt) return;
    await tx.contact.update({
      where: { companyId_id: { companyId: actor.companyId, id: contactId } },
      data: {
        displayName: `Anonymisé ${contactId.slice(-8)}`,
        legalName: null,
        email: null,
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        province: null,
        postalCode: null,
        gstNumber: null,
        qstNumber: null,
        taxExemptionNumber: null,
        notes: null,
        isActive: false,
        anonymizedAt: options.now ?? new Date(),
      },
    });
    // the audit trail keeps what was done, not the personal data (including that of the update just above)
    await tx.$queryRaw`SELECT audit_redact('contact', ${contactId}, ${[...CONTACT_PERSONAL_COLUMNS]}::text[])`;
  });
}

function invalidKey(field: unknown): string {
  const known = ["displayName", "email", "postalCode", "gstNumber", "qstNumber", "isCustomer", "paymentTermsDays", "country"];
  return typeof field === "string" && known.includes(field) ? `contacts.invalid.${field}` : "contacts.invalid.generic";
}
