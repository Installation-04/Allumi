import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { calculateTaxes } from "@/modules/taxes";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";

const iso = (date: Date) => date.toISOString().slice(0, 10);
const schema = z.object({
  issueDate: z.string().refine(isValidIsoDate),
  memo: z.string().trim().min(1).max(2000),
  revision: z.string().max(100).default(""),
  lines: z.array(z.object({ lineId: z.uuid(), amount: z.string().trim().transform(v => v.replace(",", ".")).refine(v => /^\d{1,12}(?:\.\d{1,2})?$/.test(v)) })).min(1).max(50),
});
const cents = (amount: string) => { const [whole, fraction = ""] = amount.split("."); return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0")); };
export const creditAmount = (amount: bigint) => `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
async function run<T>(actor: CompanyContext, write: boolean, fn: (tx: Tx) => Promise<T>) {
  try { return await withCompany(actor, async tx => { await requireRole(tx, write ? "sales.manage" : "sales.read"); return fn(tx); }); }
  catch (error) { throw toAppError(error); }
}
async function revision(tx: Tx, actor: CompanyContext, id: string, write: boolean) {
  const rows = write
    ? await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='CREDIT_NOTE' AND status='DRAFT' FOR UPDATE`
    : await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='CREDIT_NOTE' AND status='DRAFT'`;
  return rows[0]?.revision ?? null;
}
export async function listCreditDrafts(actor: CompanyContext, invoiceId?: string) {
  return run(actor, false, tx => tx.salesDocument.findMany({ where: { companyId: actor.companyId, kind: "CREDIT_NOTE", status: "DRAFT", ...(invoiceId ? { creditedDocumentId: invoiceId } : {}) }, include: { creditedDocument: { select: { number: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 101 }));
}
export async function getCreditDraft(actor: CompanyContext, id: string) {
  return run(actor, false, async tx => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await revision(tx, actor, id, false);
      if (!token) return null;
      const row = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id }, include: { lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: { select: { code: true } } } }, creditedDocument: { select: { id: true, number: true, status: true } } } });
      if (row && await revision(tx, actor, id, false) === token) return { ...row, revision: token };
    }
    throw new AppError("sales.stale");
  });
}
/** A draft reserves no balance and creates no entry. Original line positions retain the correction's provenance. */
export async function saveCreditDraft(actor: CompanyContext, invoiceId: string, input: unknown, id?: string) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError("sales.invalidCredit");
  const data = parsed.data;
  return run(actor, true, async tx => {
    // Serialize with invoice voiding before locking this draft.
    await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${invoiceId}::uuid AND kind='INVOICE' FOR UPDATE`;
    const invoice = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id: invoiceId, kind: "INVOICE", status: "POSTED" }, include: { lines: { orderBy: { position: "asc" } }, taxes: true } });
    if (!invoice || data.issueDate < iso(invoice.postingDate)) throw new AppError("sales.creditSource");
    if (id && await revision(tx, actor, id, true) !== data.revision) throw new AppError("sales.stale");
    const previous = id ? await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id } }) : null;
    if (previous && previous.creditedDocumentId !== invoice.id) throw new AppError("sales.creditSource");
    if (new Set(data.lines.map(l => l.lineId)).size !== data.lines.length) throw new AppError("sales.invalidCredit");
    await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
    const calculated = [];
    for (const inputLine of data.lines) {
      const source = invoice.lines.find(l => l.id === inputLine.lineId);
      const amount = cents(inputLine.amount);
      if (!source || !source.taxCodeId || amount > source.amountCents) throw new AppError("sales.invalidCredit");
      if (amount === 0n) continue;
      const code = await tx.taxCode.findFirst({ where: { companyId: actor.companyId, id: source.taxCodeId }, include: { components: true } });
      if (!code) throw new AppError("sales.creditSource");
      const taxes = code.components.map(c => {
        const tax = invoice.taxes.find(t => t.taxId === c.taxId);
        if (!tax) throw new AppError("sales.rate");
        return { id: tax.taxId, rate: tax.rate.toString() };
      });
      calculated.push({ source, amount, quantity: "1", unitPrice: creditAmount(amount), taxes });
    }
    if (!calculated.length) throw new AppError("sales.invalidCredit");
    const total = calculateTaxes(calculated, invoice.taxRounding);
    if (total.totalCents > invoice.totalCents || total.taxes.some(t => t.amountCents > (invoice.taxes.find(original => original.taxId === t.id)?.amountCents ?? 0n))) throw new AppError("sales.invalidCredit");
    const values = { issueDate: new Date(`${data.issueDate}T00:00:00Z`), postingDate: new Date(`${data.issueDate}T00:00:00Z`), memo: data.memo, subtotalCents: total.subtotalCents, taxTotalCents: total.taxCents, totalCents: total.totalCents };
    const draft = previous
      ? await tx.salesDocument.update({ where: { companyId: actor.companyId, id }, data: { ...values, updatedAt: new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1)) } })
      : await tx.salesDocument.create({ data: { ...values, companyId: actor.companyId, kind: "CREDIT_NOTE", creditedDocumentId: invoice.id, contactId: invoice.contactId, locale: invoice.locale, taxRounding: invoice.taxRounding, createdById: actor.userId } });
    if (previous) {
      await tx.salesDocumentLine.deleteMany({ where: { companyId: actor.companyId, documentId: draft.id } });
      await tx.salesDocumentTax.deleteMany({ where: { companyId: actor.companyId, documentId: draft.id } });
    }
    await tx.salesDocumentLine.createMany({ data: calculated.map(l => ({ companyId: actor.companyId, documentId: draft.id, position: l.source.position, description: l.source.description, itemId: l.source.itemId, accountId: l.source.accountId, taxCodeId: l.source.taxCodeId, quantity: l.quantity, unitPrice: l.unitPrice, amountCents: l.amount })) });
    if (total.taxes.length) await tx.salesDocumentTax.createMany({ data: total.taxes.map(t => ({ companyId: actor.companyId, documentId: draft.id, taxId: t.id, rate: t.rate, baseCents: t.baseCents, amountCents: t.amountCents })) });
    const exact = await tx.$queryRaw<{ valid: boolean }[]>`SELECT sales_document_taxes_are_exact(d) AS valid FROM sales_document d WHERE company_id=${actor.companyId}::uuid AND id=${draft.id}::uuid`;
    if (!exact[0]?.valid) throw new AppError("sales.rate");
    return draft.id;
  });
}
export async function deleteCreditDraft(actor: CompanyContext, id: string, token: string) {
  return run(actor, true, async tx => {
    if (!token || await revision(tx, actor, id, true) !== token) throw new AppError("sales.stale");
    await tx.salesDocument.delete({ where: { companyId: actor.companyId, id } });
  });
}
