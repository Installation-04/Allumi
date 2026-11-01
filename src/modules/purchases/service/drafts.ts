import "server-only";
import { requireRole } from "@/modules/companies";
import { calculateTaxes, effectiveRate } from "@/modules/taxes";
import { MAX_LINE_CENTS } from "@/modules/ledger";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { expenseSchema } from "../domain/expense";
import { acceptsDisbursements } from "@/modules/payments";
import { draftSchema } from "../domain/draft";
const iso = (date: Date) => date.toISOString().slice(0, 10);
async function run<T>(actor: CompanyContext, write: boolean, fn: (tx: Tx) => Promise<T>) {
  try { return await withCompany(actor, async tx => { await requireRole(tx, write ? "entry.post" : "ledger.read"); return fn(tx); }); }
  catch (error) { throw isConflict(error) ? new AppError("purchases.duplicate") : toAppError(error); }
}
/** Exact PostgreSQL timestamp token. Only writers request row locks: RLS denies those to readers. */
async function lock(tx: Tx, actor: CompanyContext, id: string, write: boolean, kind: "BILL" | "EXPENSE" = "BILL") {
  const rows = write
    ? await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind=${kind}::purchase_document_kind AND status='DRAFT' FOR UPDATE`
    : await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind=${kind}::purchase_document_kind AND status='DRAFT'`;
  return rows[0]?.revision ?? null;
}
export async function getDraftOptions(actor: CompanyContext) {
  return run(actor, false, async tx => {
    const where = { companyId: actor.companyId, isActive: true };
    const contacts = await tx.contact.findMany({ where: { ...where, isSupplier: true, anonymizedAt: null }, select: { id: true, displayName: true }, orderBy: [{ displayName: "asc" }, { id: "asc" }], take: 501 });
    const items = await tx.item.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: 501 });
    const accounts = await tx.account.findMany({ where: { ...where, type: "EXPENSE" }, select: { id: true, code: true, nameFr: true, nameEn: true }, orderBy: { code: "asc" } });
    const codes = await tx.taxCode.findMany({ where, select: { id: true, code: true }, orderBy: { code: "asc" } });
    return { contacts: contacts.slice(0, 500), accounts, codes, truncated: contacts.length > 500 || items.length > 500, items: items.slice(0, 500).map(i => ({ id: i.id, name: i.name, unitPrice: "0", accountId: i.expenseAccountId ?? "", taxCodeId: i.defaultTaxCodeId ?? "" })) };
  });
}
export async function listDrafts(actor: CompanyContext, q = "", kind: "BILL" | "EXPENSE" = "BILL") {
  return run(actor, false, async tx => {
    const term = q.slice(0, 100).replace(/[\\%_]/g, "\\$&");
    const rows = await tx.purchaseDocument.findMany({ where: { companyId: actor.companyId, kind, status: "DRAFT", ...(term ? { OR: [{ supplierReference: { contains: term, mode: "insensitive" as const } }, { contact: { displayName: { contains: term, mode: "insensitive" as const } } }] } : {}) }, include: { contact: { select: { displayName: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 101 });
    return { truncated: rows.length > 100, drafts: rows.slice(0, 100).map(d => ({ id: d.id, supplier: d.contact?.displayName ?? "", supplierReference: d.supplierReference, documentDate: iso(d.documentDate), totalCents: d.totalCents })) };
  });
}
export async function getDraft(actor: CompanyContext, id: string, kind: "BILL" | "EXPENSE" = "BILL") {
  return run(actor, false, async tx => {
    // Re-read the version after loading children to avoid mixing two concurrent revisions.
    for (let attempt = 0; attempt < 3; attempt++) {
    const revision = await lock(tx, actor, id, false, kind);
    if (!revision) return null;
    const row = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id }, include: { paymentAccount: { select: { code: true, nameFr: true, nameEn: true } }, contact: { select: { displayName: true } }, lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: { select: { code: true } } }, orderBy: { taxId: "asc" } } } });
    if (!row || !row.contact || !row.contactId) return null;
    if (await lock(tx, actor, id, false, kind) !== revision) continue;
    return { id: row.id, revision, paymentAccount: row.paymentAccount, paymentAccountId: row.paymentAccountId ?? "", paymentMethod: row.paymentMethod ?? "EFT", supplier: row.contact.displayName, contactId: row.contactId, documentDate: iso(row.documentDate), dueDate: row.dueDate ? iso(row.dueDate) : "", supplierReference: row.supplierReference ?? "", memo: row.memo ?? "", taxRounding: row.taxRounding, subtotalCents: row.subtotalCents, taxTotalCents: row.taxTotalCents, totalCents: row.totalCents, lines: row.lines.map(l => ({ itemId: l.itemId ?? "", description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId ?? "", amountCents: l.amountCents })), taxes: row.taxes.map(t => ({ code: t.tax.code, amountCents: t.amountCents, recoverableCents: t.recoverableCents })) };
    }
    throw new AppError("purchases.stale");
  });
}
export async function saveDraft(actor: CompanyContext, input: unknown, id?: string, kind: "BILL" | "EXPENSE" = "BILL") {
  const expense = kind === "EXPENSE" ? expenseSchema.safeParse(input) : null;
  const parsed = draftSchema.safeParse(kind === "EXPENSE" && expense?.success ? { ...expense.data, dueDate: expense.data.documentDate } : input);
  if (kind === "EXPENSE" && !expense?.success) throw new AppError("purchases.invalid");
  if (!parsed.success) throw new AppError("purchases.invalid");
  const data = parsed.data;
  return run(actor, true, async tx => {
    if (id && await lock(tx, actor, id, true, kind) !== data.revision) throw new AppError("purchases.stale");
    const company = await tx.company.findFirstOrThrow({ where: { id: actor.companyId } });
    const previous = id ? await tx.purchaseDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id } }) : null;
    if (!await tx.contact.findFirst({ where: { id: data.contactId, companyId: actor.companyId, isActive: true, isSupplier: true, anonymizedAt: null } })) throw new AppError("purchases.supplierReference");
    // Rate scheduling locks the same tax rows before changing effective intervals.
    await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
    const calculated = [];
    for (const line of data.lines) {
      if (!await tx.account.findFirst({ where: { id: line.accountId, companyId: actor.companyId, isActive: true, type: "EXPENSE" } })) throw new AppError("purchases.supplierReference");
      if (line.itemId && !await tx.item.findFirst({ where: { id: line.itemId, companyId: actor.companyId, isActive: true } })) throw new AppError("purchases.supplierReference");
      const code = await tx.taxCode.findFirst({ where: { id: line.taxCodeId, companyId: actor.companyId, isActive: true }, include: { components: { include: { tax: { include: { rates: true } } } } } });
      if (!code) throw new AppError("purchases.supplierReference");
      const taxes = code.components.map(c => {
        if (!c.tax.isActive || !c.tax.recoverableAccountId) throw new AppError("purchases.supplierReference");
        try { return { id: c.taxId, rate: effectiveRate(c.tax.rates.map(r => ({ rate: r.rate.toString(), from: iso(r.effectiveFrom), to: r.effectiveTo ? iso(r.effectiveTo) : null })), data.documentDate) }; }
        catch { throw new AppError("purchases.rate"); }
      });
      calculated.push({ ...line, taxes });
    }
    const rounding = previous?.taxRounding ?? company.taxRounding;
    const amounts = calculated.map(line => calculateTaxes([line], rounding).subtotalCents);
    const total = calculateTaxes(calculated, rounding);
    if (amounts.some(n => n > MAX_LINE_CENTS) || total.totalCents > MAX_LINE_CENTS || total.totalCents <= 0n) throw new AppError("purchases.invalid");
    if (expense?.success) {
      const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: expense.data.paymentAccountId } });
      if (!account || !acceptsDisbursements(account)) throw new AppError("purchases.paymentAccount");
    }
    const values = { ...(expense?.success ? { paymentAccountId: expense.data.paymentAccountId, paymentMethod: expense.data.paymentMethod } : {}), contactId: data.contactId, documentDate: new Date(`${data.documentDate}T00:00:00Z`), postingDate: new Date(`${data.documentDate}T00:00:00Z`), dueDate: kind === "EXPENSE" ? null : new Date(`${data.dueDate}T00:00:00Z`), supplierReference: data.supplierReference || null, memo: data.memo || null, subtotalCents: total.subtotalCents, taxTotalCents: total.taxCents, totalCents: total.totalCents };
    const row = previous
      ? await tx.purchaseDocument.update({ where: { id: previous.id, companyId: actor.companyId }, data: { ...values, updatedAt: new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1)) } })
      : await tx.purchaseDocument.create({ data: { ...values, companyId: actor.companyId, kind, taxRounding: rounding, createdById: actor.userId } });
    if (previous) {
      await tx.purchaseDocumentLine.deleteMany({ where: { companyId: actor.companyId, documentId: row.id } });
      await tx.purchaseDocumentTax.deleteMany({ where: { companyId: actor.companyId, documentId: row.id } });
    }
    await tx.purchaseDocumentLine.createMany({ data: data.lines.map((l, i) => ({ ...l, itemId: l.itemId || null, companyId: actor.companyId, documentId: row.id, position: i + 1, amountCents: amounts[i]! })) });
    if (total.taxes.length) await tx.purchaseDocumentTax.createMany({ data: total.taxes.map(t => ({ companyId: actor.companyId, documentId: row.id, taxId: t.id, rate: t.rate, baseCents: t.baseCents, amountCents: t.amountCents, recoverableCents: t.amountCents })) });
    return row.id;
  });
}
export async function deleteDraft(actor: CompanyContext, id: string, revision: string, kind: "BILL" | "EXPENSE" = "BILL") {
  return run(actor, true, async tx => {
    if (!revision || await lock(tx, actor, id, true, kind) !== revision) throw new AppError("purchases.stale");
    await tx.purchaseDocument.delete({ where: { id, companyId: actor.companyId } });
  });
}
