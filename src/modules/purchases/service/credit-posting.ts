import "server-only";
import { requireRole } from "@/modules/companies";
import { createPurchaseEntry, formatNumber, isValidIsoDate, type EntryLine } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { creditFitsBill } from "../domain/credit";
import type { Prisma } from "@/platform/db";

/** Post and fully apply to the source bill in one transaction; retries do not allocate new numbers. */
export async function postCreditNote(actor: CompanyContext, id: string, revision: string, postingDate: string) {
  if (!revision || !isValidIsoDate(postingDate)) throw new AppError("purchases.invalidCredit");
  try { return await withCompany(actor, async tx => {
    await requireRole(tx, "entry.post");
    const reference = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id, kind: "SUPPLIER_CREDIT" }, select: { creditedDocumentId: true } });
    if (!reference?.creditedDocumentId) throw new AppError("purchases.creditSource");
    await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${reference.creditedDocumentId}::uuid FOR UPDATE`;
    const locked = await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const draft = await tx.purchaseDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id }, include: { lines: true, taxes: { include: { tax: true } } } });
    if (draft.status === "POSTED") return id;
    if (draft.status !== "DRAFT" || locked[0]?.revision !== revision) throw new AppError("purchases.stale");
    const bill = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id: reference.creditedDocumentId, kind: "BILL", status: "POSTED" }, include: { lines: true, taxes: true } });
    if (!bill || !draft.contactId || bill.taxes.some(t => t.recoverableCents !== t.amountCents) || draft.creditedDocumentId !== bill.id || draft.contactId !== bill.contactId || draft.taxRounding !== bill.taxRounding || draft.documentDate < bill.postingDate || postingDate < draft.documentDate.toISOString().slice(0,10) || draft.subtotalCents <= 0n) throw new AppError("purchases.creditSource");
    const previous = await tx.purchaseDocument.findMany({ where: { companyId: actor.companyId, creditedDocumentId: bill.id, status: "POSTED" }, include: { lines: true, taxes: true } });
    if (!creditFitsBill(bill, draft, previous)) throw new AppError("purchases.creditLimit");
    const open = await tx.$queryRaw<{ amount: bigint }[]>`SELECT purchase_document_open_cents(${actor.companyId}::uuid,${bill.id}::uuid) AS amount`;
    if (!open[0] || open[0].amount < draft.totalCents) throw new AppError("purchases.creditBalance");
    await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
    const exact = await tx.$queryRaw<{ valid: boolean }[]>`SELECT purchase_document_taxes_are_exact(d) AS valid FROM purchase_document d WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid`;
    if (!exact[0]?.valid) throw new AppError("purchases.rate");
    const payable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_PAYABLE", isActive: true } });
    if (!payable) throw new AppError("ledger.notInitialized");
    const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='PURCHASE_DOCUMENT' RETURNING next_value-1 AS n,prefix,padding`;
    if (!sequence[0]) throw new AppError("ledger.notInitialized");
    const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);
    const lines: EntryLine[] = [
      { accountId: payable.id, debitCents: draft.totalCents, creditCents: 0n, contactId: draft.contactId },
      ...draft.lines.filter(l=>l.amountCents>0n).map(l=>({ accountId:l.accountId, debitCents:0n, creditCents:l.amountCents, description:l.description })),
      ...draft.taxes.filter(t=>t.amountCents>0n).map(t=>({ accountId:t.tax.recoverableAccountId!, debitCents:0n, creditCents:t.recoverableCents, taxId:t.taxId, taxBox:"RECOVERABLE" })),
    ];
    const entry = await createPurchaseEntry(tx, actor, { documentId: id, date: postingDate, memo: number, lines });
    await tx.purchaseDocument.update({ where: { companyId: actor.companyId, id }, data: { status:"POSTED",number,postingDate:new Date(`${postingDate}T00:00:00Z`),journalEntryId:entry.id,postedAt:new Date(),postedById:actor.userId,supplierSnapshot:bill.supplierSnapshot as Prisma.InputJsonObject } });
    await tx.purchaseCreditApplication.create({ data: { companyId:actor.companyId,supplierCreditId:id,billId:bill.id,amountCents:draft.totalCents,appliedDate:new Date(`${postingDate}T00:00:00Z`),createdById:actor.userId } });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return id;
  }); } catch(error) { throw toAppError(error); }
}
export async function getPostedCredit(actor: CompanyContext, id: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx,"ledger.read");
    return tx.purchaseDocument.findFirst({ where:{ companyId:actor.companyId,id,kind:"SUPPLIER_CREDIT",status:{in:["POSTED","VOID"]} },include:{ lines:{orderBy:{position:"asc"}},taxes:{include:{tax:{select:{code:true}}}},creditedDocument:{select:{id:true,number:true}},creditsApplied:{orderBy:[{appliedDate:"asc"},{id:"asc"}],include:{bill:{select:{number:true}}}},voidEntry:{select:{entryDate:true}} } });
  });
}
export async function listPostedCredits(actor: CompanyContext, billId?: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx,"ledger.read");
    return tx.purchaseDocument.findMany({where:{companyId:actor.companyId,kind:"SUPPLIER_CREDIT",status:{in:["POSTED","VOID"]},...(billId?{creditedDocumentId:billId}:{})},select:{id:true,number:true,status:true,totalCents:true,postingDate:true},orderBy:[{postedAt:"desc"},{id:"desc"}],take:101});
  });
}
