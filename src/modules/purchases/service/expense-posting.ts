import "server-only";
import { requireRole } from "@/modules/companies";
import { createPurchaseEntry, formatNumber, isValidIsoDate, todayIso, type EntryLine } from "@/modules/ledger";
import { acceptsDisbursements } from "@/modules/payments";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";

/** Validate the reviewed revision atomically; retries return the existing posting without allocating numbers. */
export async function postExpense(actor: CompanyContext, id: string, revision: string, postingDate: string) {
  if (!revision || !isValidIsoDate(postingDate)) throw new AppError("purchases.invalid");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "entry.post");
      const locked = await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='EXPENSE' FOR UPDATE`;
      if (!locked[0]) throw new AppError("purchases.stale");
      await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
      const draft = await tx.purchaseDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id }, include: { lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: true } } } });
      if (draft.status === "POSTED") return id;
      if (draft.status !== "DRAFT" || locked[0].revision !== revision) throw new AppError("purchases.stale");
      if (!draft.contactId) throw new AppError("purchases.supplierReference");
      if (postingDate > todayIso() || postingDate < draft.documentDate.toISOString().slice(0, 10) || draft.subtotalCents <= 0n) throw new AppError("purchases.invalid");
      // Freeze the issuer/supplier and tax configuration for the duration of this posting.
      await tx.$queryRaw`SELECT id FROM company WHERE id=${actor.companyId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM contact WHERE company_id=${actor.companyId}::uuid AND id=${draft.contactId}::uuid FOR SHARE`;
      const supplier = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: draft.contactId, isActive: true, isSupplier: true, anonymizedAt: null } });
      if (!supplier) throw new AppError("purchases.supplierReference");
      for (const line of draft.lines) {
        if (!await tx.account.findFirst({ where: { companyId: actor.companyId, id: line.accountId, type: "EXPENSE", isActive: true } })) throw new AppError("purchases.supplierReference");
        if (line.itemId && !await tx.item.findFirst({ where: { companyId: actor.companyId, id: line.itemId, isActive: true } })) throw new AppError("purchases.supplierReference");
        if (!line.taxCodeId || !await tx.taxCode.findFirst({ where: { companyId: actor.companyId, id: line.taxCodeId, isActive: true } })) throw new AppError("purchases.supplierReference");
      }
      if (draft.taxes.some(t => !t.tax.isActive || !t.tax.recoverableAccountId || t.recoverableCents !== t.amountCents)) throw new AppError("purchases.rate");
      const paymentAccount = draft.paymentAccountId ? await tx.account.findFirst({ where: { companyId: actor.companyId, id: draft.paymentAccountId } }) : null;
      if (!paymentAccount || !acceptsDisbursements(paymentAccount) || !draft.paymentMethod) throw new AppError("purchases.paymentAccount");
      const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='PURCHASE_DOCUMENT' RETURNING next_value-1 AS n,prefix,padding`;
      if (!sequence[0]) throw new AppError("ledger.notInitialized");
      const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);
      const lines: EntryLine[] = [
        { accountId: paymentAccount.id, debitCents: 0n, creditCents: draft.totalCents },
        ...draft.lines.filter(l => l.amountCents > 0n).map(l => ({ accountId: l.accountId, debitCents: l.amountCents, creditCents: 0n, description: l.description })),
        ...draft.taxes.filter(t => t.amountCents > 0n).map(t => ({ accountId: t.tax.recoverableAccountId!, debitCents: t.recoverableCents, creditCents: 0n, taxId: t.taxId, taxBox: "RECOVERABLE" })),
      ];
      const entry = await createPurchaseEntry(tx, actor, { documentId: id, date: postingDate, memo: number, lines });
      const address = (row: { legalName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; province: string | null; postalCode: string | null; email: string | null; phone: string | null; gstNumber: string | null; qstNumber: string | null }) => ({ legalName: row.legalName, addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city, province: row.province, postalCode: row.postalCode, email: row.email, phone: row.phone, gstNumber: row.gstNumber, qstNumber: row.qstNumber });
      await tx.purchaseDocument.update({ where: { companyId: actor.companyId, id }, data: { status: "POSTED", number, postingDate: new Date(`${postingDate}T00:00:00Z`), journalEntryId: entry.id, postedAt: new Date(), postedById: actor.userId, supplierSnapshot: { ...address(supplier), name: supplier.displayName, country: supplier.country } } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) { throw toAppError(error); }
}

export async function listExpenses(actor: CompanyContext) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    const rows = await tx.purchaseDocument.findMany({ where: { companyId: actor.companyId, kind: "EXPENSE", status: { in: ["POSTED", "VOID"] } }, select: { id: true, status: true, number: true, supplierReference: true, supplierSnapshot: true, dueDate: true, documentDate: true, totalCents: true }, orderBy: [{ postedAt: "desc" }, { id: "desc" }], take: 101 });
    return rows.map(row => {
      const snapshot = row.supplierSnapshot;
      const name = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot.name : null;
      return { ...row, supplierName: typeof name === "string" ? name : "" };
    });
  });
}
export async function getExpense(actor: CompanyContext, id: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    return tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id, kind: "EXPENSE", status: { in: ["POSTED", "VOID"] } }, include: { paymentAccount: { select: { code: true, nameFr: true, nameEn: true } }, voidEntry: { select: { entryDate: true } }, lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: { select: { code: true } } } } } });
  });
}

