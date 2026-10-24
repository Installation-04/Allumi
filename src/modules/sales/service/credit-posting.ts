import "server-only";
import { requireRole } from "@/modules/companies";
import { createInvoiceEntry, formatNumber, isValidIsoDate, type EntryLine } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { creditFitsInvoice } from "../domain/credit";
import type { Prisma } from "@/platform/db";

/** Post and fully apply to the source invoice in one transaction; retries do not allocate new numbers. */
export async function postCreditNote(actor: CompanyContext, id: string, revision: string, postingDate: string) {
  if (!revision || !isValidIsoDate(postingDate)) throw new AppError("sales.invalidCredit");
  try { return await withCompany(actor, async tx => {
    await requireRole(tx, "sales.manage");
    const reference = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id, kind: "CREDIT_NOTE" }, select: { creditedDocumentId: true } });
    if (!reference?.creditedDocumentId) throw new AppError("sales.creditSource");
    await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${reference.creditedDocumentId}::uuid FOR UPDATE`;
    const locked = await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const draft = await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id }, include: { lines: true, taxes: { include: { tax: true } } } });
    if (draft.status === "POSTED") return id;
    if (draft.status !== "DRAFT" || locked[0]?.revision !== revision) throw new AppError("sales.stale");
    const invoice = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id: reference.creditedDocumentId, kind: "INVOICE", status: "POSTED" }, include: { lines: true, taxes: true } });
    if (!invoice || draft.creditedDocumentId !== invoice.id || draft.contactId !== invoice.contactId || draft.taxRounding !== invoice.taxRounding || draft.issueDate < invoice.postingDate || postingDate < draft.issueDate.toISOString().slice(0,10) || draft.subtotalCents <= 0n) throw new AppError("sales.creditSource");
    const previous = await tx.salesDocument.findMany({ where: { companyId: actor.companyId, creditedDocumentId: invoice.id, status: "POSTED" }, include: { lines: true, taxes: true } });
    if (!creditFitsInvoice(invoice, draft, previous)) throw new AppError("sales.creditLimit");
    const open = await tx.$queryRaw<{ amount: bigint }[]>`SELECT sales_document_open_cents(${actor.companyId}::uuid,${invoice.id}::uuid) AS amount`;
    if (!open[0] || open[0].amount < draft.totalCents) throw new AppError("sales.creditBalance");
    await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
    const exact = await tx.$queryRaw<{ valid: boolean }[]>`SELECT sales_document_taxes_are_exact(d) AS valid FROM sales_document d WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid`;
    if (!exact[0]?.valid) throw new AppError("sales.rate");
    const receivable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_RECEIVABLE", isActive: true } });
    if (!receivable) throw new AppError("ledger.notInitialized");
    const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='CREDIT_NOTE' RETURNING next_value-1 AS n,prefix,padding`;
    if (!sequence[0]) throw new AppError("ledger.notInitialized");
    const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);
    const lines: EntryLine[] = [
      { accountId: receivable.id, debitCents: 0n, creditCents: draft.totalCents, contactId: draft.contactId },
      ...draft.lines.filter(l=>l.amountCents>0n).map(l=>({ accountId:l.accountId, debitCents:l.amountCents, creditCents:0n, description:l.description })),
      ...draft.taxes.filter(t=>t.amountCents>0n).map(t=>({ accountId:t.tax.payableAccountId, debitCents:t.amountCents, creditCents:0n, taxId:t.taxId, taxBox:"COLLECTED" })),
    ];
    const entry = await createInvoiceEntry(tx, actor, { documentId: id, date: postingDate, memo: number, lines });
    await tx.salesDocument.update({ where: { companyId: actor.companyId, id }, data: { status:"POSTED",number,postingDate:new Date(`${postingDate}T00:00:00Z`),journalEntryId:entry.id,postedAt:new Date(),postedById:actor.userId,issuerSnapshot:invoice.issuerSnapshot as Prisma.InputJsonObject,billingSnapshot:invoice.billingSnapshot as Prisma.InputJsonObject } });
    await tx.salesCreditApplication.create({ data: { companyId:actor.companyId,creditNoteId:id,invoiceId:invoice.id,amountCents:draft.totalCents,appliedDate:new Date(`${postingDate}T00:00:00Z`),createdById:actor.userId } });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return id;
  }); } catch(error) { throw toAppError(error); }
}
export async function getPostedCredit(actor: CompanyContext, id: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx,"sales.read");
    return tx.salesDocument.findFirst({ where:{ companyId:actor.companyId,id,kind:"CREDIT_NOTE",status:{in:["POSTED","VOID"]} },include:{ lines:{orderBy:{position:"asc"}},taxes:{include:{tax:{select:{code:true}}}},creditedDocument:{select:{id:true,number:true}},creditsApplied:true } });
  });
}
export async function listPostedCredits(actor: CompanyContext, invoiceId?: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx,"sales.read");
    return tx.salesDocument.findMany({where:{companyId:actor.companyId,kind:"CREDIT_NOTE",status:{in:["POSTED","VOID"]},...(invoiceId?{creditedDocumentId:invoiceId}:{})},select:{id:true,number:true,status:true,totalCents:true,postingDate:true},orderBy:[{postedAt:"desc"},{id:"desc"}],take:101});
  });
}
export async function getInvoiceOpenCents(actor: CompanyContext, id: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx,"sales.read");
    const rows=await tx.$queryRaw<{amount:bigint}[]>`SELECT sales_document_open_cents(company_id,id) AS amount FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='INVOICE'`;
    return rows[0]?.amount ?? null;
  });
}
