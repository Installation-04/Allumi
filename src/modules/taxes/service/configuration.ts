import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { todayIso } from "@/modules/ledger";
import { codeSchema, itemSchema, rateSchema, taxSchema } from "../domain/schemas";
import { percentageRate } from "../domain/calculation";

async function transaction<T>(actor: CompanyContext, write: boolean, fn: (tx: Tx) => Promise<T>) {
  try { return await withCompany(actor, async (tx) => { await requireRole(tx, write ? "taxes.manage" : "taxes.read"); return fn(tx); }); }
  catch (error) { if (isConflict(error)) throw new AppError("catalog.conflict"); throw toAppError(error); }
}
export async function getTaxConfiguration(actor: CompanyContext) {
  return transaction(actor, false, async (tx) => {
    const taxes = await tx.tax.findMany({ where: { companyId: actor.companyId }, include: { rates: { orderBy: { effectiveFrom: "asc" } } }, orderBy: { code: "asc" } });
    const codes = await tx.taxCode.findMany({ where: { companyId: actor.companyId }, include: { components: { orderBy: { position: "asc" } } }, orderBy: { code: "asc" } });
    return { taxes: taxes.map((tax) => ({ ...tax, rates: tax.rates.map((r) => ({ id: r.id, rate: r.rate.toString(), from: r.effectiveFrom.toISOString().slice(0, 10), to: r.effectiveTo?.toISOString().slice(0, 10) ?? null })) })), codes };
  });
}
export async function createTax(actor: CompanyContext, input: unknown) {
  const parsed = taxSchema.safeParse(input);
  if (!parsed.success) throw new AppError("catalog.invalid");
  const { percent, from, ...data } = parsed.data;
  return transaction(actor, true, async (tx) => {
    const ids = [data.payableAccountId, data.recoverableAccountId].filter((id): id is string => !!id);
    const accounts = await tx.account.findMany({ where: { companyId: actor.companyId, id: { in: ids }, isActive: true, subtype: "SALES_TAX" } });
    if (accounts.length !== ids.length || new Set(ids).size !== ids.length || accounts.find((a) => a.id === data.payableAccountId)?.type !== "LIABILITY" || (data.recoverableAccountId && accounts.find((a) => a.id === data.recoverableAccountId)?.type !== "ASSET")) throw new AppError("catalog.reference");
    const tax = await tx.tax.create({ data: { ...data, companyId: actor.companyId } });
    await tx.taxRate.create({ data: { companyId: actor.companyId, taxId: tax.id, rate: percentageRate(percent), effectiveFrom: new Date(`${from}T00:00:00Z`) } });
    return tax.id;
  });
}
/** Future changes only, serialized by tax; the previous interval ends the day before. */
export async function scheduleRate(actor: CompanyContext, input: unknown) {
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success || parsed.data.from <= todayIso()) throw new AppError("catalog.futureRate");
  const { taxId, percent, from } = parsed.data;
  return transaction(actor, true, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tax WHERE company_id = ${actor.companyId}::uuid AND id = ${taxId}::uuid AND is_active FOR UPDATE`;
    if (locked.length !== 1) throw new AppError("catalog.reference");
    const latest = await tx.taxRate.findFirst({ where: { companyId: actor.companyId, taxId }, orderBy: { effectiveFrom: "desc" } });
    const effectiveFrom = new Date(`${from}T00:00:00Z`);
    if (latest && latest.effectiveFrom >= effectiveFrom) throw new AppError("catalog.futureRate");
    // Do not change the effective rate of documents already posted with a future issue date.
    const [sales, purchases] = await Promise.all([
      tx.salesDocumentTax.count({ where: { companyId: actor.companyId, taxId, document: { is: { status: "POSTED", issueDate: { gte: effectiveFrom } } } } }),
      tx.purchaseDocumentTax.count({ where: { companyId: actor.companyId, taxId, document: { is: { status: "POSTED", documentDate: { gte: effectiveFrom } } } } }),
    ]);
    if (sales || purchases) throw new AppError("catalog.futureRate");
    if (latest && (!latest.effectiveTo || latest.effectiveTo >= effectiveFrom)) {
      await tx.taxRate.update({ where: { id: latest.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - 86400000) } });
    }
    await tx.taxRate.create({ data: { companyId: actor.companyId, taxId, rate: percentageRate(percent), effectiveFrom } });
  });
}
export async function createTaxCode(actor: CompanyContext, input: unknown) {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) throw new AppError("catalog.invalid");
  const { taxIds, ...data } = parsed.data;
  return transaction(actor, true, async (tx) => {
    if (await tx.tax.count({ where: { companyId: actor.companyId, id: { in: taxIds }, isActive: true } }) !== taxIds.length) throw new AppError("catalog.reference");
    const code = await tx.taxCode.create({ data: { companyId: actor.companyId, ...data } });
    for (const [index, taxId] of taxIds.entries()) await tx.taxCodeComponent.create({ data: { companyId: actor.companyId, taxCodeId: code.id, taxId, position: index + 1 } });
    return code.id;
  });
}
export async function listItems(actor: CompanyContext, q = "", includeInactive = false) {
  if (q.length > 100) throw new AppError("catalog.invalid");
  return transaction(actor, false, async (tx) => {
    const term = q.replace(/[\\%_]/g, "\\$&");
    const rows = await tx.item.findMany({ where: { companyId: actor.companyId, ...(includeInactive ? {} : { isActive: true }), ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" as const } }, { code: { contains: term, mode: "insensitive" as const } }] } : {}) }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 101 });
    return { truncated: rows.length > 100, items: rows.slice(0, 100).map((row) => ({ ...row, unitPrice: row.unitPrice?.toString() ?? "" })) };
  });
}
export async function getItem(actor: CompanyContext, id: string) {
  return transaction(actor, false, async (tx) => {
    const row = await tx.item.findFirst({ where: { id, companyId: actor.companyId } });
    return row ? { ...row, unitPrice: row.unitPrice?.toString() ?? "" } : null;
  });
}
export async function saveItem(actor: CompanyContext, input: unknown, id?: string) {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) throw new AppError("catalog.invalid");
  const data = parsed.data;
  return transaction(actor, true, async (tx) => {
    for (const [accountId, type] of [[data.incomeAccountId, "REVENUE"], [data.expenseAccountId, "EXPENSE"]] as const) {
      if (accountId && !await tx.account.findFirst({ where: { id: accountId, companyId: actor.companyId, isActive: true, type } })) throw new AppError("catalog.reference");
    }
    if (data.defaultTaxCodeId && !await tx.taxCode.findFirst({ where: { companyId: actor.companyId, id: data.defaultTaxCodeId, isActive: true } })) throw new AppError("catalog.reference");
    if (!id) return (await tx.item.create({ data: { companyId: actor.companyId, ...data } })).id;
    const result = await tx.item.updateMany({ where: { companyId: actor.companyId, id }, data });
    if (result.count !== 1) throw new AppError("catalog.notFound");
    return id;
  });
}
export async function archiveCatalog(actor: CompanyContext, kind: "item" | "taxCode", id: string, active: boolean) {
  return transaction(actor, true, async (tx) => {
    const args = { where: { companyId: actor.companyId, id }, data: { isActive: active } };
    const result = kind === "item" ? await tx.item.updateMany(args) : await tx.taxCode.updateMany(args);
    if (result.count !== 1) throw new AppError("catalog.notFound");
  });
}
