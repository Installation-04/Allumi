import "server-only";
import { requireRole } from "@/modules/companies";
import { createInvoiceReversal, isValidIsoDate } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";

/** Unapply from the original invoice and reverse the credit atomically. */
export async function voidCreditNote(actor: CompanyContext, id: string, date: string, reason: string) {
  const memo = reason.trim();
  if (!isValidIsoDate(date) || !memo || memo.length > 500) throw new AppError("sales.invalidVoid");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      const reference = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id, kind: "CREDIT_NOTE" }, select: { creditedDocumentId: true } });
      if (!reference?.creditedDocumentId) throw new AppError("sales.creditSource");
      // Match posting/draft lock order: source invoice before its credit.
      await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${reference.creditedDocumentId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
      const credit = await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id }, include: { creditsApplied: true, allocations: true } });
      if (credit.status === "VOID") return id;
      if (credit.status !== "POSTED" || !credit.journalEntryId || credit.creditedDocumentId !== reference.creditedDocumentId) throw new AppError("sales.stale");
      const history = [...credit.creditsApplied, ...credit.allocations];
      if (date < credit.postingDate.toISOString().slice(0, 10) || history.some(a => date < (a.unappliedDate ?? a.appliedDate).toISOString().slice(0, 10))) throw new AppError("sales.creditVoidDate");
      // Do not silently alter refunds or applications to other invoices.
      if (credit.allocations.some(a => !a.unappliedDate) || credit.creditsApplied.some(a => !a.unappliedDate && a.invoiceId !== reference.creditedDocumentId)) throw new AppError("sales.creditVoidLinked");
      await tx.salesCreditApplication.updateMany({ where: { companyId: actor.companyId, creditNoteId: id, invoiceId: reference.creditedDocumentId, unappliedDate: null }, data: { unappliedDate: new Date(`${date}T00:00:00Z`), unappliedById: actor.userId } });
      const reversal = await createInvoiceReversal(tx, actor, { documentId: id, entryId: credit.journalEntryId, date, memo });
      await tx.salesDocument.update({ where: { companyId: actor.companyId, id }, data: { status: "VOID", voidEntryId: reversal.id, voidedAt: new Date(), voidedById: actor.userId, voidReason: memo } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) { throw toAppError(error); }
}
