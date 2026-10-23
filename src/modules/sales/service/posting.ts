import "server-only";
import { requireRole } from "@/modules/companies";
import { createInvoiceEntry, formatNumber, isValidIsoDate, type EntryLine } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";

/** Validate the reviewed revision atomically; retries return the existing posting without allocating numbers. */
export async function postInvoice(actor: CompanyContext, id: string, revision: string, postingDate: string) {
  if (!revision || !isValidIsoDate(postingDate)) throw new AppError("sales.invalid");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      const locked = await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='INVOICE' FOR UPDATE`;
      if (!locked[0]) throw new AppError("sales.stale");
      await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
      const draft = await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id }, include: { lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: true } } } });
      if (draft.status === "POSTED") return id;
      if (draft.status !== "DRAFT" || locked[0].revision !== revision) throw new AppError("sales.stale");
      if (postingDate < draft.issueDate.toISOString().slice(0, 10) || draft.subtotalCents <= 0n) throw new AppError("sales.invalid");
      // Freeze the issuer/customer and tax configuration for the duration of this posting.
      await tx.$queryRaw`SELECT id FROM company WHERE id=${actor.companyId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM contact WHERE company_id=${actor.companyId}::uuid AND id=${draft.contactId}::uuid FOR SHARE`;
      const company = await tx.company.findFirstOrThrow({ where: { id: actor.companyId } });
      const customer = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: draft.contactId, isActive: true, isCustomer: true, anonymizedAt: null } });
      if (!customer) throw new AppError("sales.reference");
      for (const line of draft.lines) {
        if (!await tx.account.findFirst({ where: { companyId: actor.companyId, id: line.accountId, type: "REVENUE", isActive: true } })) throw new AppError("sales.reference");
        if (line.itemId && !await tx.item.findFirst({ where: { companyId: actor.companyId, id: line.itemId, isActive: true } })) throw new AppError("sales.reference");
        if (!line.taxCodeId || !await tx.taxCode.findFirst({ where: { companyId: actor.companyId, id: line.taxCodeId, isActive: true } })) throw new AppError("sales.reference");
      }
      const exact = await tx.$queryRaw<{ valid: boolean }[]>`SELECT sales_document_taxes_are_exact(d) AS valid FROM sales_document d WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid`;
      if (!exact[0]?.valid || draft.taxes.some(t => !t.tax.isActive)) throw new AppError("sales.rate");
      const receivable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_RECEIVABLE", isActive: true } });
      if (!receivable) throw new AppError("ledger.notInitialized");
      const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='INVOICE' RETURNING next_value-1 AS n,prefix,padding`;
      if (!sequence[0]) throw new AppError("ledger.notInitialized");
      const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);
      const lines: EntryLine[] = [
        { accountId: receivable.id, debitCents: draft.totalCents, creditCents: 0n, contactId: customer.id },
        ...draft.lines.filter(l => l.amountCents > 0n).map(l => ({ accountId: l.accountId, debitCents: 0n, creditCents: l.amountCents, description: l.description })),
        ...draft.taxes.filter(t => t.amountCents > 0n).map(t => ({ accountId: t.tax.payableAccountId, debitCents: 0n, creditCents: t.amountCents, taxId: t.taxId, taxBox: "COLLECTED" })),
      ];
      const entry = await createInvoiceEntry(tx, actor, { documentId: id, date: postingDate, memo: number, lines });
      const address = (row: { legalName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; province: string | null; postalCode: string | null; email: string | null; phone: string | null; gstNumber: string | null; qstNumber: string | null }) => ({ legalName: row.legalName, addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city, province: row.province, postalCode: row.postalCode, email: row.email, phone: row.phone, gstNumber: row.gstNumber, qstNumber: row.qstNumber });
      await tx.salesDocument.update({ where: { companyId: actor.companyId, id }, data: { status: "POSTED", number, postingDate: new Date(`${postingDate}T00:00:00Z`), journalEntryId: entry.id, postedAt: new Date(), postedById: actor.userId, issuerSnapshot: { ...address(company), name: company.name, neq: company.neq, businessNumber: company.businessNumber, country: "CA" }, billingSnapshot: { ...address(customer), name: customer.displayName, country: customer.country } } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) { throw toAppError(error); }
}

export async function listInvoices(actor: CompanyContext) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    return tx.salesDocument.findMany({ where: { companyId: actor.companyId, kind: "INVOICE", status: { in: ["POSTED", "VOID"] } }, select: { id: true, status: true, number: true, issueDate: true, totalCents: true }, orderBy: [{ postedAt: "desc" }, { id: "desc" }], take: 101 });
  });
}
export async function getInvoice(actor: CompanyContext, id: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    return tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id, kind: "INVOICE", status: { in: ["POSTED", "VOID"] } }, include: { voidEntry: { select: { entryDate: true } }, lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: { select: { code: true } } } } } });
  });
}
