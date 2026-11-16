import "server-only";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/modules/companies";
import { createPaymentEntry, createPaymentReversal, formatNumber, isValidIsoDate, todayIso } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { supplierRefundSchema, acceptsSupplierRefunds } from "../domain/supplier-refund";
import { receiptVoidSchema } from "../domain/receipt";
import { disbursementHistoryWhere, disbursementSupplierNames } from "./history";
import { assertReceiptMovementDate } from "./movement-dates";
const iso = (date: Date) => date.toISOString().slice(0, 10);
export const SUPPLIER_REFUNDS_PER_PAGE = 25;
export const SUPPLIER_REFUND_ORIGINS_PER_PAGE = 25;

/** Bills precede credits, matching purchase posting, applications and cancellation. */
async function lockCredit(tx: Tx, companyId: string, id: string) {
  const reference = await tx.purchaseDocument.findFirst({ where: { companyId, id, kind: "SUPPLIER_CREDIT" }, select: { creditedDocumentId: true } });
  if (!reference?.creditedDocumentId) throw new AppError("supplierRefunds.creditNotFound");
  await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${companyId}::uuid AND id=${reference.creditedDocumentId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
  const credit = await tx.purchaseDocument.findFirst({ where: { companyId, id, kind: "SUPPLIER_CREDIT" }, select: { id: true, status: true, number: true, contactId: true, postingDate: true, creditedDocumentId: true } });
  if (!credit || credit.creditedDocumentId !== reference.creditedDocumentId) throw new AppError("supplierRefunds.creditNotFound");
  return credit;
}
async function checkCreditDate(tx: Tx, companyId: string, id: string, date: string) {
  const rows = await tx.$queryRaw<{ latest: Date | null }[]>`SELECT max(d) AS latest FROM (
    SELECT posting_date AS d FROM purchase_document WHERE company_id=${companyId}::uuid AND id=${id}::uuid
    UNION ALL SELECT applied_date FROM payment_allocation WHERE company_id=${companyId}::uuid AND purchase_document_id=${id}::uuid
    UNION ALL SELECT unapplied_date FROM payment_allocation WHERE company_id=${companyId}::uuid AND purchase_document_id=${id}::uuid
    UNION ALL SELECT applied_date FROM purchase_credit_application WHERE company_id=${companyId}::uuid AND supplier_credit_id=${id}::uuid
    UNION ALL SELECT unapplied_date FROM purchase_credit_application WHERE company_id=${companyId}::uuid AND supplier_credit_id=${id}::uuid
  ) movements`;
  if (rows[0]?.latest && date < iso(rows[0].latest)) throw new AppError("supplierRefunds.dateBeforeMovement");
}

/** Record money already received: bank/cash/card debit, supplier payable credit. No bank instruction is sent. */
export async function recordSupplierRefund(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string; number: string }> {
  const parsed = supplierRefundSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("supplierRefunds.invalid");
  const { supplierCreditId, amountCents, expectedOpenCents, date, accountId, method, reference, memo } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("supplierRefunds.futureDate");
  try { return await withCompany(actor, async tx => {
    await requireRole(tx, "entry.post");
    const credit = await lockCredit(tx, actor.companyId, supplierCreditId);
    if (!credit.contactId) throw new AppError("supplierRefunds.creditNotFound");
    if (credit.status !== "POSTED") throw new AppError("supplierRefunds.creditNotOpen");
    if (date < iso(credit.postingDate)) throw new AppError("supplierRefunds.dateBeforeCredit");
    await checkCreditDate(tx, actor.companyId, supplierCreditId, date);
    const [balance] = await tx.$queryRaw<{ cents: bigint }[]>`SELECT purchase_document_open_cents(${actor.companyId}::uuid,${supplierCreditId}::uuid) AS cents`;
    if (!balance || balance.cents !== expectedOpenCents) throw new AppError("supplierRefunds.stale");
    if (amountCents > balance.cents) throw new AppError("supplierRefunds.exceeds");
    const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId }, select: { subtype: true, isActive: true } });
    if (!account || !acceptsSupplierRefunds(account)) throw new AppError("supplierRefunds.account");
    const payable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_PAYABLE", isActive: true }, select: { id: true } });
    if (!payable) throw new AppError("ledger.notInitialized");
    const [sequence] = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='PAYMENT_RECEIVED'::sequence_key RETURNING next_value-1 AS n,prefix,padding`;
    if (!sequence) throw new AppError("ledger.notInitialized");
    const number = formatNumber(sequence.prefix, sequence.padding, sequence.n), id = randomUUID();
    const entry = await createPaymentEntry(tx, actor, { paymentId: id, date, memo: `${number} · ${credit.number}`, lines: [
      { accountId, debitCents: amountCents, creditCents: 0n },
      { accountId: payable.id, debitCents: 0n, creditCents: amountCents, contactId: credit.contactId },
    ] });
    const day = new Date(`${date}T00:00:00Z`);
    await tx.payment.create({ data: { id, companyId: actor.companyId, direction: "RECEIVED", ledger: "PAYABLE", number, contactId: credit.contactId, paymentDate: day, amountCents, accountId, method, reference, memo, journalEntryId: entry.id, createdById: actor.userId } });
    await tx.paymentAllocation.create({ data: { companyId: actor.companyId, paymentId: id, purchaseDocumentId: supplierCreditId, amountCents, appliedDate: day, createdById: actor.userId } });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return { id, number };
  }); } catch (error) { throw toAppError(error); }
}

/** Reverse once, preserving allocations and their release date. Legacy offsets require separate resolution. */
export async function voidSupplierRefund(actor: CompanyContext, id: string, input: unknown): Promise<string> {
  const parsed = receiptVoidSchema.strict().safeParse(input);
  if (!supplierRefundSchema.shape.supplierCreditId.safeParse(id).success || !parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("supplierRefunds.invalidVoid");
  const { date, reason } = parsed.data;
  if (date > todayIso()) throw new AppError("supplierRefunds.futureDate");
  try { return await withCompany(actor, async tx => {
    await requireRole(tx, "entry.post");await requireRole(tx, "entry.reverse");
    await tx.$queryRaw`SELECT id FROM payment WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND direction='RECEIVED' AND ledger='PAYABLE' FOR UPDATE`;
    const payment = await tx.payment.findFirst({ where: { companyId: actor.companyId, id, direction: "RECEIVED", ledger: "PAYABLE" } });
    if (!payment) throw new AppError("supplierRefunds.notFound");
    if (payment.status === "VOID") return id;
    if (await tx.paymentOffset.findFirst({ where: { companyId: actor.companyId, receivedPaymentId: id, unappliedDate: null }, select: { id: true } })) throw new AppError("supplierRefunds.linked");
    await assertReceiptMovementDate(tx, actor.companyId, id, date, "supplierRefunds.invalidVoid");
    const allocations = await tx.paymentAllocation.findMany({ where: { companyId: actor.companyId, paymentId: id }, select: { purchaseDocumentId: true } });
    const ids = [...new Set(allocations.flatMap(a => a.purchaseDocumentId ? [a.purchaseDocumentId] : []))].sort();
    // Lock all source bills before any credits for multi-origin legacy payments.
    await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND kind='BILL' AND id IN (SELECT credited_document_id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=ANY(${ids}::uuid[])) ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    for (const creditId of ids) await checkCreditDate(tx, actor.companyId, creditId, date);
    await tx.paymentAllocation.updateMany({ where: { companyId: actor.companyId, paymentId: id, unappliedDate: null }, data: { unappliedDate: new Date(`${date}T00:00:00Z`), unappliedById: actor.userId } });
    const reversal = await createPaymentReversal(tx, actor, { paymentId: id, entryId: payment.journalEntryId, date, memo: reason });
    await tx.payment.update({ where: { companyId_id: { companyId: actor.companyId, id } }, data: { status: "VOID", voidEntryId: reversal.id, voidedAt: new Date(), voidedById: actor.userId, voidReason: reason } });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return id;
  }); } catch (error) { throw toAppError(error); }
}
export async function listSupplierRefundAccounts(actor: CompanyContext) {
  return withCompany(actor, async tx => { await requireRole(tx, "ledger.read");return (await tx.account.findMany({ where: { companyId: actor.companyId, isActive: true, subtype: { in: ["BANK", "CASH", "CREDIT_CARD"] } }, select: { id: true, code: true, nameFr: true, nameEn: true, subtype: true, isActive: true }, orderBy: { code: "asc" } })).filter(acceptsSupplierRefunds); });
}
function historyWhere(companyId: string, filters: unknown) { return { ...disbursementHistoryWhere(companyId, filters), direction: "RECEIVED" as const }; }
export async function listSupplierRefunds(actor: CompanyContext, requestedPage = 1, filters: unknown = {}) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");const where = historyWhere(actor.companyId, filters), total = await tx.payment.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / SUPPLIER_REFUNDS_PER_PAGE)), page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1), pageCount);
    const rows = await tx.payment.findMany({ where, select: { id: true, contactId: true, number: true, paymentDate: true, amountCents: true, status: true, method: true, reference: true }, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], skip: (page-1)*SUPPLIER_REFUNDS_PER_PAGE, take: SUPPLIER_REFUNDS_PER_PAGE });
    const names = await disbursementSupplierNames(tx, actor.companyId, rows);
    return { refunds: rows.map(p => ({ ...p, number: p.number ?? "", date: iso(p.paymentDate), supplier: names.get(p.id) ?? "" })), total, page, pageCount };
  });
}
export async function getSupplierRefund(actor: CompanyContext, id: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");const payment = await tx.payment.findFirst({ where: { companyId: actor.companyId, id, direction: "RECEIVED", ledger: "PAYABLE" }, include: { account: { select: { code: true, nameFr: true, nameEn: true } }, voidEntry: { select: { entryDate: true } } } });
    if (!payment) return null;const names = await disbursementSupplierNames(tx, actor.companyId, [payment]);
    return { ...payment, number: payment.number ?? "", date: iso(payment.paymentDate), supplier: names.get(id) ?? "", voidDate: payment.voidEntry ? iso(payment.voidEntry.entryDate) : null };
  });
}
export async function listSupplierRefundOrigins(actor: CompanyContext, id: string, requestedPage = 1) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");if (!await tx.payment.findFirst({ where: { companyId: actor.companyId, id, direction: "RECEIVED", ledger: "PAYABLE" }, select: { id: true } })) throw new AppError("supplierRefunds.notFound");
    const where = { companyId: actor.companyId, paymentId: id }, total = await tx.paymentAllocation.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / SUPPLIER_REFUND_ORIGINS_PER_PAGE)), page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1), pageCount);
    const rows = await tx.paymentAllocation.findMany({ where, select: { id: true, purchaseDocumentId: true, amountCents: true, appliedDate: true, unappliedDate: true, purchaseDocument: { select: { number: true } } }, orderBy: [{ appliedDate: "desc" }, { id: "desc" }], skip: (page-1)*SUPPLIER_REFUND_ORIGINS_PER_PAGE, take: SUPPLIER_REFUND_ORIGINS_PER_PAGE });
    return { origins: rows.map(a => ({ id: a.id, creditId: a.purchaseDocumentId ?? "", number: a.purchaseDocument?.number ?? "", amountCents: a.amountCents, date: iso(a.appliedDate), unappliedDate: a.unappliedDate ? iso(a.unappliedDate) : null })), total, page, pageCount };
  });
}
export async function listCreditSupplierRefunds(actor: CompanyContext, creditId: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");const rows = await tx.paymentAllocation.findMany({ where: { companyId: actor.companyId, purchaseDocumentId: creditId, payment: { direction: "RECEIVED", ledger: "PAYABLE" } }, select: { id: true, amountCents: true, unappliedDate: true, payment: { select: { id: true, number: true, paymentDate: true } } }, orderBy: [{ appliedDate: "desc" }, { id: "desc" }], take: 26 });
    return { payments: rows.slice(0,25).map(a => ({ id: a.payment.id, number: a.payment.number ?? "", date: iso(a.payment.paymentDate), amountCents: a.amountCents, unappliedDate: a.unappliedDate ? iso(a.unappliedDate) : null })), hasMore: rows.length>25 };
  });
}

export const SUPPLIER_REFUND_EXPORT_LIMIT = 10_000;

/** Export the complete filtered history with a public accounting-field whitelist, never a single page. */
export async function exportSupplierRefunds(actor: CompanyContext, filters: unknown = {}, options: { maxRows?: number } = {}) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    const limit = options.maxRows ?? SUPPLIER_REFUND_EXPORT_LIMIT;
    if (!Number.isInteger(limit) || limit < 0 || limit > SUPPLIER_REFUND_EXPORT_LIMIT) throw new AppError("payments.invalidFilters");
    const rows = await tx.payment.findMany({
      where: historyWhere(actor.companyId, filters),
      select: { id: true, contactId: true, number: true, paymentDate: true, amountCents: true, status: true, method: true, reference: true },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    });
    if (rows.length > limit) throw new AppError("supplierRefunds.exportLimit");
    const names = await disbursementSupplierNames(tx, actor.companyId, rows);
    return rows.map(row => ({ number: row.number ?? "", date: iso(row.paymentDate), supplier: names.get(row.id) ?? "", amountCents: row.amountCents, status: row.status, method: row.method, reference: row.reference }));
  });
}
