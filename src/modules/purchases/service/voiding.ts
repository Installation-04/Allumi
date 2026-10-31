import "server-only";
import { requireRole } from "@/modules/companies";
import { createPurchaseReversal, isValidIsoDate } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";

export async function voidBill(actor: CompanyContext, id: string, date: string, reason: string) {
  const memo = reason.trim();
  if (!isValidIsoDate(date) || !memo || memo.length > 500) throw new AppError("purchases.invalidVoid");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "entry.post");
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='BILL' FOR UPDATE`;
      if (!locked[0]) throw new AppError("purchases.stale");
      const invoice = await tx.purchaseDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id } });
      if (invoice.status === "VOID") return id;
      if (invoice.status !== "POSTED" || !invoice.journalEntryId) throw new AppError("purchases.stale");
      if (date < invoice.postingDate.toISOString().slice(0, 10)) throw new AppError("purchases.invalidVoid");
      const linked = await tx.paymentAllocation.count({ where: { companyId: actor.companyId, purchaseDocumentId: id, unappliedDate: null } })
        + await tx.purchaseCreditApplication.count({ where: { companyId: actor.companyId, OR: [{ billId: id }, { supplierCreditId: id }], unappliedDate: null } })
        + await tx.purchaseDocument.count({ where: { companyId: actor.companyId, creditedDocumentId: id, status: "POSTED" } });
      if (linked) throw new AppError("purchases.linked");
      const reversal = await createPurchaseReversal(tx, actor, { documentId: id, entryId: invoice.journalEntryId, date, memo });
      await tx.purchaseDocument.update({ where: { companyId: actor.companyId, id }, data: { status: "VOID", voidEntryId: reversal.id, voidedAt: new Date(), voidedById: actor.userId, voidReason: memo } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) { throw toAppError(error); }
}
