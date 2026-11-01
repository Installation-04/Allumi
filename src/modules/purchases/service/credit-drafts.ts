import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { calculateTaxes } from "@/modules/taxes";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";

const iso = (date: Date) => date.toISOString().slice(0, 10);
const schema = z.object({
  documentDate: z.string().refine(isValidIsoDate),
  memo: z.string().trim().min(1).max(2000),
  revision: z.string().max(100).default(""),
  lines: z.array(z.object({ lineId: z.uuid(), amount: z.string().trim().transform(v => v.replace(",", ".")).refine(v => /^\d{1,12}(?:\.\d{1,2})?$/.test(v)) })).min(1).max(50),
});
const cents = (amount: string) => { const [whole, fraction = ""] = amount.split("."); return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0")); };
export const creditAmount = (amount: bigint) => `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
async function run<T>(actor: CompanyContext, write: boolean, fn: (tx: Tx) => Promise<T>) {
  try { return await withCompany(actor, async tx => { await requireRole(tx, write ? "entry.post" : "ledger.read"); return fn(tx); }); }
  catch (error) { throw toAppError(error); }
}
async function revision(tx: Tx, actor: CompanyContext, id: string, write: boolean) {
  const rows = write
    ? await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='SUPPLIER_CREDIT' AND status='DRAFT' FOR UPDATE`
    : await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='SUPPLIER_CREDIT' AND status='DRAFT'`;
  return rows[0]?.revision ?? null;
}
export async function listCreditDrafts(actor: CompanyContext, billId?: string) {
  return run(actor, false, tx => tx.purchaseDocument.findMany({ where: { companyId: actor.companyId, kind: "SUPPLIER_CREDIT", status: "DRAFT", ...(billId ? { creditedDocumentId: billId } : {}) }, include: { creditedDocument: { select: { number: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 101 }));
}
export async function getCreditDraft(actor: CompanyContext, id: string) {
  return run(actor, false, async tx => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await revision(tx, actor, id, false);
      if (!token) return null;
      const row = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id }, include: { lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: { select: { code: true } } } }, creditedDocument: { select: { id: true, number: true, status: true } } } });
      if (row && await revision(tx, actor, id, false) === token) return { ...row, revision: token };
    }
    throw new AppError("purchases.stale");
  });
}
/** A draft reserves no balance and creates no entry. Original line positions retain the correction's provenance. */
export async function saveCreditDraft(actor: CompanyContext, billId: string, input: unknown, id?: string) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError("purchases.invalidCredit");
  const data = parsed.data;
  return run(actor, true, async tx => {
    // Serialize with bill voiding before locking this draft.
    await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${billId}::uuid AND kind='BILL' FOR UPDATE`;
    const bill = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id: billId, kind: "BILL", status: "POSTED" }, include: { lines: { orderBy: { position: "asc" } }, taxes: true } });
    if (!bill || !bill.contactId || bill.taxes.some(t => t.recoverableCents !== t.amountCents) || data.documentDate < iso(bill.postingDate)) throw new AppError("purchases.creditSource");
    if (id && await revision(tx, actor, id, true) !== data.revision) throw new AppError("purchases.stale");
    const previous = id ? await tx.purchaseDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id } }) : null;
    if (previous && previous.creditedDocumentId !== bill.id) throw new AppError("purchases.creditSource");
    if (new Set(data.lines.map(l => l.lineId)).size !== data.lines.length) throw new AppError("purchases.invalidCredit");
    await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
    const calculated = [];
    for (const inputLine of data.lines) {
      const source = bill.lines.find(l => l.id === inputLine.lineId);
      const amount = cents(inputLine.amount);
      if (!source || !source.taxCodeId || amount > source.amountCents) throw new AppError("purchases.invalidCredit");
      if (amount === 0n) continue;
      const code = await tx.taxCode.findFirst({ where: { companyId: actor.companyId, id: source.taxCodeId }, include: { components: true } });
      if (!code) throw new AppError("purchases.creditSource");
      const taxes = code.components.map(c => {
        const tax = bill.taxes.find(t => t.taxId === c.taxId);
        if (!tax) throw new AppError("purchases.rate");
        return { id: tax.taxId, rate: tax.rate.toString() };
      });
      calculated.push({ source, amount, quantity: "1", unitPrice: creditAmount(amount), taxes });
    }
    if (!calculated.length) throw new AppError("purchases.invalidCredit");
    const total = calculateTaxes(calculated, bill.taxRounding);
    if (total.totalCents > bill.totalCents || total.taxes.some(t => t.amountCents > (bill.taxes.find(original => original.taxId === t.id)?.amountCents ?? 0n))) throw new AppError("purchases.invalidCredit");
    const values = { documentDate: new Date(`${data.documentDate}T00:00:00Z`), postingDate: new Date(`${data.documentDate}T00:00:00Z`), memo: data.memo, subtotalCents: total.subtotalCents, taxTotalCents: total.taxCents, totalCents: total.totalCents };
    const draft = previous
      ? await tx.purchaseDocument.update({ where: { companyId: actor.companyId, id }, data: { ...values, updatedAt: new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1)) } })
      : await tx.purchaseDocument.create({ data: { ...values, companyId: actor.companyId, kind: "SUPPLIER_CREDIT", creditedDocumentId: bill.id, contactId: bill.contactId, taxRounding: bill.taxRounding, createdById: actor.userId } });
    if (previous) {
      await tx.purchaseDocumentLine.deleteMany({ where: { companyId: actor.companyId, documentId: draft.id } });
      await tx.purchaseDocumentTax.deleteMany({ where: { companyId: actor.companyId, documentId: draft.id } });
    }
    await tx.purchaseDocumentLine.createMany({ data: calculated.map(l => ({ companyId: actor.companyId, documentId: draft.id, position: l.source.position, description: l.source.description, itemId: l.source.itemId, accountId: l.source.accountId, taxCodeId: l.source.taxCodeId, quantity: l.quantity, unitPrice: l.unitPrice, amountCents: l.amount })) });
    if (total.taxes.length) await tx.purchaseDocumentTax.createMany({ data: total.taxes.map(t => ({ companyId: actor.companyId, documentId: draft.id, taxId: t.id, rate: t.rate, baseCents: t.baseCents, amountCents: t.amountCents, recoverableCents: t.amountCents })) });
    return draft.id;
  });
}
export async function deleteCreditDraft(actor: CompanyContext, id: string, token: string) {
  return run(actor, true, async tx => {
    if (!token || await revision(tx, actor, id, true) !== token) throw new AppError("purchases.stale");
    await tx.purchaseDocument.delete({ where: { companyId: actor.companyId, id } });
  });
}
