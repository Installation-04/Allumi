import "server-only";
import { requireRole } from "@/modules/companies";
import { calculateTaxes, effectiveRate } from "@/modules/taxes";
import { MAX_LINE_CENTS } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { draftSchema } from "../domain/draft";
const iso = (date: Date) => date.toISOString().slice(0, 10);
async function run<T>(actor: CompanyContext, write: boolean, fn: (tx: Tx) => Promise<T>) {
  try { return await withCompany(actor, async tx => { await requireRole(tx, write ? "sales.manage" : "sales.read"); return fn(tx); }); }
  catch (error) { throw toAppError(error); }
}
/** Exact PostgreSQL timestamp token. Only writers request row locks: RLS denies those to readers. */
async function lock(tx: Tx, actor: CompanyContext, id: string, write: boolean) {
  const rows = write
    ? await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='INVOICE' AND status='DRAFT' FOR UPDATE`
    : await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='INVOICE' AND status='DRAFT'`;
  return rows[0]?.revision ?? null;
}
export async function getDraftOptions(actor: CompanyContext) {
  return run(actor, false, async tx => {
    const where = { companyId: actor.companyId, isActive: true };
    const contacts = await tx.contact.findMany({ where: { ...where, isCustomer: true, anonymizedAt: null }, select: { id: true, displayName: true }, orderBy: [{ displayName: "asc" }, { id: "asc" }], take: 501 });
    const items = await tx.item.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: 501 });
    const accounts = await tx.account.findMany({ where: { ...where, type: "REVENUE" }, select: { id: true, code: true, nameFr: true, nameEn: true }, orderBy: { code: "asc" } });
    const codes = await tx.taxCode.findMany({ where, select: { id: true, code: true }, orderBy: { code: "asc" } });
    return { contacts: contacts.slice(0, 500), accounts, codes, truncated: contacts.length > 500 || items.length > 500, items: items.slice(0, 500).map(i => ({ id: i.id, name: i.name, unitPrice: i.unitPrice?.toString() ?? "0", accountId: i.incomeAccountId ?? "", taxCodeId: i.defaultTaxCodeId ?? "" })) };
  });
}
export async function listDrafts(actor: CompanyContext, q = "") {
  return run(actor, false, async tx => {
    const term = q.slice(0, 100).replace(/[\\%_]/g, "\\$&");
    const rows = await tx.salesDocument.findMany({ where: { companyId: actor.companyId, kind: "INVOICE", status: "DRAFT", ...(term ? { OR: [{ reference: { contains: term, mode: "insensitive" as const } }, { contact: { displayName: { contains: term, mode: "insensitive" as const } } }] } : {}) }, include: { contact: { select: { displayName: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 101 });
    return { truncated: rows.length > 100, drafts: rows.slice(0, 100).map(d => ({ id: d.id, customer: d.contact.displayName, reference: d.reference, issueDate: iso(d.issueDate), totalCents: d.totalCents })) };
  });
}
export async function getDraft(actor: CompanyContext, id: string) {
  return run(actor, false, async tx => {
    // Re-read the version after loading children to avoid mixing two concurrent revisions.
    for (let attempt = 0; attempt < 3; attempt++) {
    const revision = await lock(tx, actor, id, false);
    if (!revision) return null;
    const row = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id }, include: { contact: { select: { displayName: true } }, lines: { orderBy: { position: "asc" } }, taxes: { include: { tax: { select: { code: true } } }, orderBy: { taxId: "asc" } } } });
    if (!row) return null;
    if (await lock(tx, actor, id, false) !== revision) continue;
    return { id: row.id, revision, customer: row.contact.displayName, contactId: row.contactId, issueDate: iso(row.issueDate), dueDate: row.dueDate ? iso(row.dueDate) : "", reference: row.reference ?? "", memo: row.memo ?? "", taxRounding: row.taxRounding, locale: row.locale, subtotalCents: row.subtotalCents, taxTotalCents: row.taxTotalCents, totalCents: row.totalCents, lines: row.lines.map(l => ({ itemId: l.itemId ?? "", description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId ?? "", amountCents: l.amountCents })), taxes: row.taxes.map(t => ({ code: t.tax.code, amountCents: t.amountCents })) };
    }
    throw new AppError("sales.stale");
  });
}
export async function saveDraft(actor: CompanyContext, input: unknown, id?: string) {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw new AppError("sales.invalid");
  const data = parsed.data;
  return run(actor, true, async tx => {
    if (id && await lock(tx, actor, id, true) !== data.revision) throw new AppError("sales.stale");
    const company = await tx.company.findFirstOrThrow({ where: { id: actor.companyId } });
    const previous = id ? await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id } }) : null;
    if (!await tx.contact.findFirst({ where: { id: data.contactId, companyId: actor.companyId, isActive: true, isCustomer: true, anonymizedAt: null } })) throw new AppError("sales.reference");
    // Rate scheduling locks the same tax rows before changing effective intervals.
    await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
    const calculated = [];
    for (const line of data.lines) {
      if (!await tx.account.findFirst({ where: { id: line.accountId, companyId: actor.companyId, isActive: true, type: "REVENUE" } })) throw new AppError("sales.reference");
      if (line.itemId && !await tx.item.findFirst({ where: { id: line.itemId, companyId: actor.companyId, isActive: true } })) throw new AppError("sales.reference");
      const code = await tx.taxCode.findFirst({ where: { id: line.taxCodeId, companyId: actor.companyId, isActive: true }, include: { components: { include: { tax: { include: { rates: true } } } } } });
      if (!code) throw new AppError("sales.reference");
      const taxes = code.components.map(c => {
        if (!c.tax.isActive) throw new AppError("sales.reference");
        try { return { id: c.taxId, rate: effectiveRate(c.tax.rates.map(r => ({ rate: r.rate.toString(), from: iso(r.effectiveFrom), to: r.effectiveTo ? iso(r.effectiveTo) : null })), data.issueDate) }; }
        catch { throw new AppError("sales.rate"); }
      });
      calculated.push({ ...line, taxes });
    }
    const rounding = previous?.taxRounding ?? company.taxRounding;
    const amounts = calculated.map(line => calculateTaxes([line], rounding).subtotalCents);
    const total = calculateTaxes(calculated, rounding);
    if (amounts.some(n => n > MAX_LINE_CENTS) || total.totalCents > MAX_LINE_CENTS || total.totalCents <= 0n) throw new AppError("sales.invalid");
    const values = { contactId: data.contactId, issueDate: new Date(`${data.issueDate}T00:00:00Z`), postingDate: new Date(`${data.issueDate}T00:00:00Z`), dueDate: new Date(`${data.dueDate}T00:00:00Z`), reference: data.reference || null, memo: data.memo || null, subtotalCents: total.subtotalCents, taxTotalCents: total.taxCents, totalCents: total.totalCents };
    const row = previous
      ? await tx.salesDocument.update({ where: { id: previous.id, companyId: actor.companyId }, data: { ...values, updatedAt: new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1)) } })
      : await tx.salesDocument.create({ data: { ...values, companyId: actor.companyId, kind: "INVOICE", taxRounding: rounding, locale: company.defaultLocale, createdById: actor.userId } });
    if (previous) {
      await tx.salesDocumentLine.deleteMany({ where: { companyId: actor.companyId, documentId: row.id } });
      await tx.salesDocumentTax.deleteMany({ where: { companyId: actor.companyId, documentId: row.id } });
    }
    await tx.salesDocumentLine.createMany({ data: data.lines.map((l, i) => ({ ...l, itemId: l.itemId || null, companyId: actor.companyId, documentId: row.id, position: i + 1, amountCents: amounts[i]! })) });
    if (total.taxes.length) await tx.salesDocumentTax.createMany({ data: total.taxes.map(t => ({ companyId: actor.companyId, documentId: row.id, taxId: t.id, rate: t.rate, baseCents: t.baseCents, amountCents: t.amountCents })) });
    const exact = await tx.$queryRaw<{ valid: boolean }[]>`SELECT sales_document_taxes_are_exact(d) AS valid FROM sales_document d WHERE company_id=${actor.companyId}::uuid AND id=${row.id}::uuid`;
    if (!exact[0]?.valid) throw new AppError("sales.rate");
    return row.id;
  });
}
export async function deleteDraft(actor: CompanyContext, id: string, revision: string) {
  return run(actor, true, async tx => {
    if (!revision || await lock(tx, actor, id, true) !== revision) throw new AppError("sales.stale");
    await tx.salesDocument.delete({ where: { id, companyId: actor.companyId } });
  });
}
