import "server-only";
import { requireRole } from "@/modules/companies";
import { formatNumber, isValidIsoDate, todayIso } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { ESTIMATE_STATUSES, estimateSchema, estimateTaxSchema, estimateTransitionAllowed, snapshotSchema, type EstimateStatus } from "../domain/estimate";
import { prepareSalesDraft, saveDraftWithin } from "./drafts";
const iso = (date: Date) => date.toISOString().slice(0, 10);
async function run<T>(actor: CompanyContext, write: boolean, fn: (tx: Tx) => Promise<T>) {
  try { return await withCompany(actor, async tx => { await requireRole(tx, write ? "sales.manage" : "sales.read"); return fn(tx); }); }
  catch (error) { throw toAppError(error); }
}
async function references(tx: Tx) {
  for (const action of ["contact.read", "ledger.read", "taxes.read"] as const) await requireRole(tx, action);
}
async function version(tx: Tx, actor: CompanyContext, id: string, write = false) {
  const rows = write
    ? await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_estimate WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`
    : await tx.$queryRaw<{ revision: string }[]>`SELECT updated_at::text AS revision FROM sales_estimate WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid`;
  return rows[0]?.revision ?? null;
}
async function locked(tx: Tx, actor: CompanyContext, id: string) {
  const revision = await version(tx, actor, id, true);
  const row = revision ? await tx.salesEstimate.findFirst({ where: { companyId: actor.companyId, id }, include: { lines: { orderBy: { position: "asc" } } } }) : null;
  if (!row) throw new AppError("estimates.stale");
  return { row, revision };
}
function current(revision: string | null, reviewed: string) {
  if (!reviewed || revision !== reviewed) throw new AppError("estimates.stale");
}
const address = (row: { legalName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; province: string | null; postalCode: string | null; email: string | null; phone: string | null; gstNumber: string | null; qstNumber: string | null }) => ({ legalName: row.legalName, addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city, province: row.province, postalCode: row.postalCode, email: row.email, phone: row.phone, gstNumber: row.gstNumber, qstNumber: row.qstNumber });
export async function saveEstimate(actor: CompanyContext, input: unknown, id?: string) {
  const parsed = estimateSchema.safeParse(input);
  if (!parsed.success || parsed.data.issueDate > todayIso()) throw new AppError("estimates.invalid");
  const data = parsed.data;
  return run(actor, true, async tx => {
    await references(tx);
    const previous = id ? await locked(tx, actor, id) : null;
    if (previous) { current(previous.revision, data.revision); if (previous.row.status !== "DRAFT") throw new AppError("estimates.immutable"); }
    const { company, rounding, calculated, amounts, total } = await prepareSalesDraft(tx, actor, data, previous?.row.taxRounding);
    const taxes = await tx.tax.findMany({ where: { companyId: actor.companyId, id: { in: total.taxes.map(t => t.id) } }, select: { id: true, code: true } });
    const taxSummary = total.taxes.map(t => ({ id: t.id, code: taxes.find(tax => tax.id === t.id)!.code, rate: t.rate, baseCents: t.baseCents.toString(), amountCents: t.amountCents.toString() }));
    const values = { contactId: data.contactId, issueDate: new Date(`${data.issueDate}T00:00:00Z`), validUntil: new Date(`${data.dueDate}T00:00:00Z`), reference: data.reference || null, memo: data.memo || null, terms: data.terms || null, subtotalCents: total.subtotalCents, taxTotalCents: total.taxCents, totalCents: total.totalCents, taxSummary };
    const row = previous
      ? await tx.salesEstimate.update({ where: { id, companyId: actor.companyId }, data: values })
      : await tx.salesEstimate.create({ data: { ...values, companyId: actor.companyId, taxRounding: rounding, locale: company.defaultLocale, createdById: actor.userId } });
    if (previous) await tx.salesEstimateLine.deleteMany({ where: { companyId: actor.companyId, estimateId: row.id } });
    await tx.salesEstimateLine.createMany({ data: calculated.map((l, i) => ({ companyId: actor.companyId, estimateId: row.id, position: i + 1, itemId: l.itemId || null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: l.accountId, taxCodeId: l.taxCodeId, amountCents: amounts[i]!, taxes: l.taxes })) });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return row.id;
  });
}
export async function getEstimate(actor: CompanyContext, id: string) {
  return run(actor, false, async tx => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = await version(tx, actor, id);
      if (!revision) return null;
      const row = await tx.salesEstimate.findFirst({ where: { companyId: actor.companyId, id }, include: { lines: { orderBy: { position: "asc" } } } });
      if (!row) return null;
      const customer = row.customerSnapshot ? snapshotSchema.parse(row.customerSnapshot) : null;
      const linkedInvoice = row.convertedInvoiceId ? await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id: row.convertedInvoiceId }, select: { status: true } }) : null;
      const live = customer ? null : await tx.contact.findFirst({ where: { companyId: actor.companyId, id: row.contactId }, select: { displayName: true } });
      if (await version(tx, actor, id) !== revision) continue;
      return { id: row.id, revision, status: row.status as EstimateStatus, number: row.number, customer: customer?.name ?? live?.displayName ?? null, customerSnapshot: customer, issuerSnapshot: row.issuerSnapshot ? snapshotSchema.parse(row.issuerSnapshot) : null, contactId: row.contactId, issueDate: iso(row.issueDate), dueDate: iso(row.validUntil), expired: row.status === "SENT" && iso(row.validUntil) < todayIso(), reference: row.reference ?? "", memo: row.memo ?? "", terms: row.terms ?? "", decisionNote: row.decisionNote ?? "", taxRounding: row.taxRounding, subtotalCents: row.subtotalCents, taxTotalCents: row.taxTotalCents, totalCents: row.totalCents, convertedInvoiceId: row.convertedInvoiceId, convertedInvoiceStatus: linkedInvoice?.status ?? null, taxes: estimateTaxSchema.parse(row.taxSummary).map(t => ({ ...t, baseCents: BigInt(t.baseCents), amountCents: BigInt(t.amountCents) })), lines: row.lines.map(l => ({ itemId: l.itemId ?? "", description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId, amountCents: l.amountCents })) };
    }
    throw new AppError("estimates.stale");
  });
}
export async function listEstimates(actor: CompanyContext, options: { q?: string; status?: string; page?: number } = {}) {
  const q = (options.q ?? "").trim();
  const status = options.status ?? "";
  const page = options.page ?? 1;
  if (q.length > 120 || /[\u0000-\u001f\u007f]/.test(q) || (status && status !== "EXPIRED" && !(ESTIMATE_STATUSES as readonly string[]).includes(status)) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new AppError("estimates.invalid");
  const term = q.replace(/[\\%_]/g, "\\$&");
  return run(actor, false, async tx => {
    const where = { companyId: actor.companyId, ...(status === "EXPIRED" ? { status: "SENT", validUntil: { lt: new Date(`${todayIso()}T00:00:00Z`) } } : status ? { status } : {}), ...(term ? { OR: [{ number: { contains: term, mode: "insensitive" as const } }, { reference: { contains: term, mode: "insensitive" as const } }, { customerSnapshot: { path: ["name"], string_contains: term, mode: "insensitive" as const } }, { contact: { displayName: { contains: term, mode: "insensitive" as const } } }] } : {}) };
    const rows = await tx.salesEstimate.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 51, skip: (page - 1) * 50 });
    const contacts = await tx.contact.findMany({ where: { companyId: actor.companyId, id: { in: rows.filter(r => !r.customerSnapshot).map(r => r.contactId) } }, select: { id: true, displayName: true } });
    return { page, hasMore: rows.length > 50, estimates: rows.slice(0, 50).map(r => ({ id: r.id, number: r.number, reference: r.reference, customer: r.customerSnapshot ? snapshotSchema.parse(r.customerSnapshot).name : contacts.find(c => c.id === r.contactId)?.displayName ?? null, status: r.status as EstimateStatus, expired: r.status === "SENT" && iso(r.validUntil) < todayIso(), issueDate: iso(r.issueDate), validUntil: iso(r.validUntil), totalCents: r.totalCents })) };
  });
}
/** Records manual delivery/response only; this does not send email or authenticate a customer signature. */
export async function transitionEstimate(actor: CompanyContext, id: string, revision: string, status: "SENT" | "ACCEPTED" | "DECLINED" | "CANCELLED", note = "") {
  if (note.length > 500 || (!["ACCEPTED", "DECLINED"].includes(status) && note.trim())) throw new AppError("estimates.invalid");
  return run(actor, true, async tx => {
    const { row, revision: actual } = await locked(tx, actor, id);
    current(actual, revision);
    if (!estimateTransitionAllowed(row.status, status, iso(row.validUntil), todayIso())) throw new AppError("estimates.transition");
    if (status === "SENT") {
      await references(tx);
      await tx.$queryRaw`SELECT id FROM tax WHERE company_id=${actor.companyId}::uuid ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM company WHERE id=${actor.companyId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM contact WHERE company_id=${actor.companyId}::uuid AND id=${row.contactId}::uuid FOR SHARE`;
      const company = await tx.company.findFirstOrThrow({ where: { id: actor.companyId } });
      const contact = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: row.contactId, isActive: true, isCustomer: true, anonymizedAt: null } });
      if (!contact) throw new AppError("sales.reference");
      await tx.$executeRaw`INSERT INTO sales_estimate_counter(company_id) VALUES(${actor.companyId}::uuid) ON CONFLICT(company_id) DO NOTHING`;
      const [counter] = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`UPDATE sales_estimate_counter SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid RETURNING next_value-1 AS n,prefix,padding`;
      await tx.salesEstimate.update({ where: { companyId: actor.companyId, id }, data: { status, number: formatNumber(counter!.prefix, counter!.padding, counter!.n), issuedAt: new Date(), customerSnapshot: { ...address(contact), name: contact.displayName, country: contact.country }, issuerSnapshot: { ...address(company), name: company.name, country: "CA" } } });
    } else await tx.salesEstimate.update({ where: { companyId: actor.companyId, id }, data: { status, ...(["ACCEPTED", "DECLINED"].includes(status) ? { decisionNote: note.trim() || null, respondedAt: new Date() } : {}) } });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return id;
  });
}
export async function convertEstimate(actor: CompanyContext, id: string, revision: string, issueDate: string, dueDate: string) {
  if (!isValidIsoDate(issueDate) || !isValidIsoDate(dueDate) || issueDate > todayIso() || dueDate < issueDate) throw new AppError("estimates.invalid");
  return run(actor, true, async tx => {
    const { row, revision: actual } = await locked(tx, actor, id);
    if (row.status === "CONVERTED" && row.convertedInvoiceId) return row.convertedInvoiceId;
    current(actual, revision);
    if (row.status !== "ACCEPTED" || issueDate < iso(row.issueDate)) throw new AppError("estimates.transition");
    await references(tx);
    const invoiceId = await saveDraftWithin(tx, actor, { contactId: row.contactId, issueDate, dueDate, reference: row.reference ?? row.number ?? "", memo: row.memo ?? "", lines: row.lines.map(l => ({ itemId: l.itemId ?? "", description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId })) }, undefined, row.taxRounding);
    await tx.salesEstimate.update({ where: { companyId: actor.companyId, id }, data: { status: "CONVERTED", convertedInvoiceId: invoiceId, convertedAt: new Date() } });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return invoiceId;
  });
}
export async function deleteEstimate(actor: CompanyContext, id: string, revision: string) {
  return run(actor, true, async tx => {
    const { row, revision: actual } = await locked(tx, actor, id);
    current(actual, revision);
    if (row.status !== "DRAFT") throw new AppError("estimates.immutable");
    await tx.salesEstimate.delete({ where: { companyId: actor.companyId, id } });
  });
}
