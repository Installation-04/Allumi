import "server-only";
import { requireRole } from "@/modules/companies";
import { createPurchaseReversal, isValidIsoDate } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";

/** Unapply from the original bill and reverse the credit atomically. */
export async function voidCreditNote(actor: CompanyContext, id: string, date: string, reason: string) {
  const memo = reason.trim();
  if (!isValidIsoDate(date) || !memo || memo.length > 500) throw new AppError("purchases.invalidVoid");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "entry.post");
      const reference = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id, kind: "SUPPLIER_CREDIT" }, select: { creditedDocumentId: true } });
      if (!reference?.creditedDocumentId) throw new AppError("purchases.creditSource");
      // Match posting/draft lock order: source bill before its credit.
      await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${reference.creditedDocumentId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
      const credit = await tx.purchaseDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id }, include: { creditsApplied: true, allocations: true } });
      if (credit.status === "VOID") return id;
      if (credit.status !== "POSTED" || !credit.journalEntryId || credit.creditedDocumentId !== reference.creditedDocumentId) throw new AppError("purchases.stale");
      const history = [...credit.creditsApplied, ...credit.allocations];
      if (date < credit.postingDate.toISOString().slice(0, 10) || history.some(a => date < (a.unappliedDate ?? a.appliedDate).toISOString().slice(0, 10))) throw new AppError("purchases.creditVoidDate");
      // Do not silently alter refunds or applications to other bills.
      if (credit.allocations.some(a => !a.unappliedDate) || credit.creditsApplied.some(a => !a.unappliedDate && a.billId !== reference.creditedDocumentId)) throw new AppError("purchases.creditVoidLinked");
      await tx.purchaseCreditApplication.updateMany({ where: { companyId: actor.companyId, supplierCreditId: id, billId: reference.creditedDocumentId, unappliedDate: null }, data: { unappliedDate: new Date(`${date}T00:00:00Z`), unappliedById: actor.userId } });
      const reversal = await createPurchaseReversal(tx, actor, { documentId: id, entryId: credit.journalEntryId, date, memo });
      await tx.purchaseDocument.update({ where: { companyId: actor.companyId, id }, data: { status: "VOID", voidEntryId: reversal.id, voidedAt: new Date(), voidedById: actor.userId, voidReason: memo } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) { throw toAppError(error); }
}
