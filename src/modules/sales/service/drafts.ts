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
    const rows = await tx.salesDocument.findMany({ where: { companyId: actor.companyId, kind: "INVOICE", status: "DRAFT", ...(term ? { OR: [{ reference: { contains: term, mode: "insensitive" as const } }, { contact: { displayName: { contains: term, mode: "insensitive" as const } } }] } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 101 });
    const contacts = await tx.contact.findMany({ where: { companyId: actor.companyId, id: { in: rows.map(d => d.contactId) } }, select: { id: true, displayName: true } });
    return { truncated: rows.length > 100, drafts: rows.slice(0, 100).map(d => ({ id: d.id, customer: contacts.find(c => c.id === d.contactId)?.displayName ?? "", reference: d.reference, issueDate: iso(d.issueDate), totalCents: d.totalCents })) };
  });
}
export async function getDraft(actor: CompanyContext, id: string) {
  return run(actor, false, async tx => {
    // Re-read the version after loading children to avoid mixing two concurrent revisions.
    for (let attempt = 0; attempt < 3; attempt++) {
    const revision = await lock(tx, actor, id, false);
    if (!revision) return null;
    const row = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id }, include: { sourceEstimate: { select: { id: true, number: true } }, lines: { orderBy: { position: "asc" } }, taxes: { orderBy: { taxId: "asc" } } } });
    if (!row) return null;
    const customer = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: row.contactId }, select: { displayName: true } });
    const taxes = await tx.tax.findMany({ where: { companyId: actor.companyId, id: { in: row.taxes.map(t => t.taxId) } }, select: { id: true, code: true } });
    if (await lock(tx, actor, id, false) !== revision) continue;
    return { id: row.id, sourceEstimate: row.sourceEstimate, revision, customer: customer?.displayName ?? "", contactId: row.contactId, issueDate: iso(row.issueDate), dueDate: row.dueDate ? iso(row.dueDate) : "", reference: row.reference ?? "", memo: row.memo ?? "", taxRounding: row.taxRounding, locale: row.locale, subtotalCents: row.subtotalCents, taxTotalCents: row.taxTotalCents, totalCents: row.totalCents, lines: row.lines.map(l => ({ itemId: l.itemId ?? "", description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId ?? "", amountCents: l.amountCents })), taxes: row.taxes.map(t => ({ id: t.taxId, code: taxes.find(tax => tax.id === t.taxId)?.code ?? "", amountCents: t.amountCents })) };
    }
    throw new AppError("sales.stale");
  });
}
export async function saveDraft(actor: CompanyContext, input: unknown, id?: string) {
  return run(actor,true,tx=>saveDraftWithin(tx,actor,input,id));
}
export async function saveDraftWithin(tx: Tx, actor: CompanyContext, input: unknown, id?: string, roundingOverride?: "PER_LINE" | "PER_DOCUMENT") {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw new AppError("sales.invalid");
  const data = parsed.data;
    await requireRole(tx,"sales.manage");
    if (id && await lock(tx, actor, id, true) !== data.revision) throw new AppError("sales.stale");
    const previous = id ? await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id } }) : null;
    if(previous) {
      const source = await tx.salesEstimate.findFirst({where:{companyId:actor.companyId,convertedInvoiceId:id}});
      if(source && data.contactId !== source.contactId)throw new AppError("estimates.customerLocked");
    }
    const { company, rounding, amounts, total } = await prepareSalesDraft(tx, actor, data, previous?.taxRounding ?? roundingOverride);
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
}
export async function prepareSalesDraft(tx: Tx, actor: CompanyContext, data: ReturnType<typeof draftSchema.parse>, roundingOverride?: "PER_LINE" | "PER_DOCUMENT") {
    const company = await tx.company.findFirstOrThrow({ where: { id: actor.companyId } });
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
    const rounding = roundingOverride ?? company.taxRounding;
    const amounts = calculated.map(line => calculateTaxes([line], rounding).subtotalCents);
    const total = calculateTaxes(calculated, rounding);
    if (amounts.some(n => n > MAX_LINE_CENTS) || total.totalCents > MAX_LINE_CENTS || total.totalCents <= 0n) throw new AppError("sales.invalid");
    return { company, rounding, calculated, amounts, total };
}

export async function deleteDraft(actor: CompanyContext, id: string, revision: string) {
  return run(actor, true, async tx => {
    if (!revision || await lock(tx, actor, id, true) !== revision) throw new AppError("sales.stale");
    const quotes=await tx.$queryRaw<{id:string}[]>`SELECT id FROM sales_estimate WHERE company_id=${actor.companyId}::uuid AND converted_invoice_id=${id}::uuid FOR UPDATE`;
    if(quotes[0])await tx.salesEstimate.update({where:{companyId:actor.companyId,id:quotes[0].id},data:{status:"ACCEPTED",convertedInvoiceId:null,convertedAt:null}});
    await tx.salesDocument.delete({ where: { id, companyId: actor.companyId } });
  });
}
