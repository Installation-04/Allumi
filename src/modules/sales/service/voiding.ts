import "server-only";
import { requireRole } from "@/modules/companies";
import { createInvoiceReversal, isValidIsoDate } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";

export async function voidInvoice(actor: CompanyContext, id: string, date: string, reason: string) {
  const memo = reason.trim();
  if (!isValidIsoDate(date) || !memo || memo.length > 500) throw new AppError("sales.invalidVoid");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='INVOICE' FOR UPDATE`;
      if (!locked[0]) throw new AppError("sales.stale");
      const invoice = await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id } });
      if (invoice.status === "VOID") return id;
      if (invoice.status !== "POSTED" || !invoice.journalEntryId) throw new AppError("sales.stale");
      if (date < invoice.postingDate.toISOString().slice(0, 10)) throw new AppError("sales.invalidVoid");
      const linked = await tx.paymentAllocation.count({ where: { companyId: actor.companyId, salesDocumentId: id, unappliedDate: null } })
        + await tx.salesCreditApplication.count({ where: { companyId: actor.companyId, OR: [{ invoiceId: id }, { creditNoteId: id }], unappliedDate: null } })
        + await tx.salesDocument.count({ where: { companyId: actor.companyId, creditedDocumentId: id, status: "POSTED" } });
      if (linked) throw new AppError("sales.linked");
      const reversal = await createInvoiceReversal(tx, actor, { documentId: id, entryId: invoice.journalEntryId, date, memo });
      await tx.salesDocument.update({ where: { companyId: actor.companyId, id }, data: { status: "VOID", voidEntryId: reversal.id, voidedAt: new Date(), voidedById: actor.userId, voidReason: memo } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) { throw toAppError(error); }
}
