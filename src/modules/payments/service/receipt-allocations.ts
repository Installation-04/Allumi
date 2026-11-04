import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate, todayIso } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { receiptAllocationSchema, receiptUnallocationSchema } from "../domain/receipt-allocation";
import { assertCustomerMovementDate, assertReceiptMovementDate } from "./movement-dates";

export const RECEIPT_ALLOCATION_TARGET_LIMIT = 50;
export const RECEIPT_ALLOCATIONS_PER_PAGE = 25;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const validId = (id: string) => receiptAllocationSchema.shape.paymentId.safeParse(id).success;

async function lockReceipt(tx: Tx, actor: CompanyContext, paymentId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payment WHERE company_id=${actor.companyId}::uuid AND id=${paymentId}::uuid AND direction='RECEIVED' AND ledger='RECEIVABLE' FOR UPDATE`;
  if (!rows[0]) throw new AppError("receiptAllocations.paymentNotFound");
  return tx.payment.findFirstOrThrow({ where: { companyId: actor.companyId, id: paymentId }, select: { id: true, status: true, paymentDate: true, contactId: true } });
}
async function lockInvoice(tx: Tx, actor: CompanyContext, invoiceId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${invoiceId}::uuid AND kind='INVOICE' FOR UPDATE`;
  if (!rows[0]) throw new AppError("receiptAllocations.invoiceNotFound");
  return tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id: invoiceId }, select: { id: true, status: true, postingDate: true, contactId: true } });
}
async function checkDate(tx: Tx, actor: CompanyContext, paymentId: string, invoiceId: string, date: string) {
  await assertReceiptMovementDate(tx, actor.companyId, paymentId, date, "receiptAllocations.dateBeforeMovement");
  await assertCustomerMovementDate(tx, actor.companyId, invoiceId, date, "receiptAllocations.dateBeforeMovement");
  const periods = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM fiscal_period WHERE company_id=${actor.companyId}::uuid AND ${date}::date BETWEEN start_date AND end_date FOR SHARE`;
  if (periods.length !== 1 || periods[0]?.status !== "OPEN") throw new AppError("receiptAllocations.periodClosed");
}

/** Later allocations settle the invoice only; the receipt already posted its bank and receivable movements. */
export async function applyReceiptToInvoice(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string }> {
  const parsed = receiptAllocationSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("receiptAllocations.invalid");
  const { paymentId, invoiceId, amountCents, expectedPaymentCents, expectedInvoiceCents, date } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("receiptAllocations.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      await requireRole(tx, "entry.post");
      const payment = await lockReceipt(tx, actor, paymentId);
      const invoice = await lockInvoice(tx, actor, invoiceId);
      if (payment.status !== "POSTED" || invoice.status !== "POSTED") throw new AppError("receiptAllocations.notPosted");
      if (payment.contactId !== invoice.contactId) throw new AppError("receiptAllocations.customerMismatch");
      await checkDate(tx, actor, paymentId, invoiceId, date);
      const balances = await tx.$queryRaw<{ payment: bigint; invoice: bigint }[]>`SELECT payment_open_cents(${actor.companyId}::uuid,${paymentId}::uuid) AS payment,sales_document_open_cents(${actor.companyId}::uuid,${invoiceId}::uuid) AS invoice`;
      if (!balances[0] || balances[0].payment !== expectedPaymentCents || balances[0].invoice !== expectedInvoiceCents) throw new AppError("receiptAllocations.stale");
      if (amountCents > balances[0].payment || amountCents > balances[0].invoice) throw new AppError("receiptAllocations.exceeds");
      if (await tx.paymentAllocation.findFirst({ where: { companyId: actor.companyId, paymentId, salesDocumentId: invoiceId, unappliedDate: null }, select: { id: true } })) throw new AppError("receiptAllocations.alreadyApplied");
      const allocation = await tx.paymentAllocation.create({ data: { companyId: actor.companyId, paymentId, salesDocumentId: invoiceId, amountCents, appliedDate: new Date(`${date}T00:00:00Z`), createdById: actor.userId }, select: { id: true } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return allocation;
    });
  } catch (error) { throw toAppError(error); }
}

/** Keep the original allocation and release it once at the chosen effective date. */
export async function unapplyReceiptAllocation(actor: CompanyContext, allocationId: string, input: unknown, options: { now?: Date } = {}): Promise<string> {
  const parsed = receiptUnallocationSchema.safeParse(input);
  if (!validId(allocationId) || !parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("receiptAllocations.invalid");
  const { date } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("receiptAllocations.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      await requireRole(tx, "entry.post");
      const reference = await tx.paymentAllocation.findFirst({ where: { companyId: actor.companyId, id: allocationId, salesDocument: { kind: "INVOICE" }, payment: { direction: "RECEIVED", ledger: "RECEIVABLE" } }, select: { paymentId: true, salesDocumentId: true } });
      if (!reference?.salesDocumentId) throw new AppError("receiptAllocations.allocationNotFound");
      const payment = await lockReceipt(tx, actor, reference.paymentId);
      const invoice = await lockInvoice(tx, actor, reference.salesDocumentId);
      await tx.$queryRaw`SELECT id FROM payment_allocation WHERE company_id=${actor.companyId}::uuid AND id=${allocationId}::uuid FOR UPDATE`;
      const allocation = await tx.paymentAllocation.findFirstOrThrow({ where: { companyId: actor.companyId, id: allocationId } });
      if (allocation.unappliedDate) return allocation.id;
      if (payment.status !== "POSTED" || invoice.status !== "POSTED") throw new AppError("receiptAllocations.notPosted");
      await checkDate(tx, actor, payment.id, invoice.id, date);
      await tx.paymentAllocation.update({ where: { companyId: actor.companyId, id: allocationId }, data: { unappliedDate: new Date(`${date}T00:00:00Z`), unappliedById: actor.userId } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return allocation.id;
    });
  } catch (error) { throw toAppError(error); }
}

export async function getReceiptOpenCents(actor: CompanyContext, paymentId: string): Promise<bigint> {
  if (!validId(paymentId)) throw new AppError("receiptAllocations.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const rows = await tx.$queryRaw<{ cents: bigint }[]>`SELECT payment_open_cents(company_id,id) AS cents FROM payment WHERE company_id=${actor.companyId}::uuid AND id=${paymentId}::uuid AND direction='RECEIVED' AND ledger='RECEIVABLE' AND status='POSTED'`;
    return rows[0]?.cents ?? 0n;
  });
}

export async function listReceiptAllocationTargets(actor: CompanyContext, paymentId: string, q = "") {
  if (!validId(paymentId) || typeof q !== "string" || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) throw new AppError("receiptAllocations.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const payment = await tx.payment.findFirst({ where: { companyId: actor.companyId, id: paymentId, direction: "RECEIVED", ledger: "RECEIVABLE", status: "POSTED" }, select: { contactId: true } });
    if (!payment) throw new AppError("receiptAllocations.paymentNotFound");
    const pattern = `%${q.trim().replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const rows = await tx.$queryRaw<{ id: string; number: string; date: Date; totalCents: bigint; openCents: bigint }[]>`
      SELECT id,number,posting_date AS date,total_cents AS "totalCents",sales_document_open_cents(company_id,id) AS "openCents"
      FROM sales_document WHERE company_id=${actor.companyId}::uuid AND contact_id=${payment.contactId}::uuid AND kind='INVOICE' AND status='POSTED'
        AND (number ILIKE ${pattern} OR coalesce(reference,'') ILIKE ${pattern}) AND sales_document_open_cents(company_id,id)>0
        AND NOT EXISTS (SELECT 1 FROM payment_allocation a WHERE a.company_id=sales_document.company_id AND a.payment_id=${paymentId}::uuid AND a.sales_document_id=sales_document.id AND a.unapplied_date IS NULL)
      ORDER BY posting_date DESC,number DESC,id DESC LIMIT ${RECEIPT_ALLOCATION_TARGET_LIMIT + 1}`;
    return { invoices: rows.slice(0, RECEIPT_ALLOCATION_TARGET_LIMIT).map(row => ({ ...row, date: iso(row.date) })), hasMore: rows.length > RECEIPT_ALLOCATION_TARGET_LIMIT };
  });
}

export async function listReceiptAllocations(actor: CompanyContext, paymentId: string, requestedPage = 1) {
  if (!validId(paymentId)) throw new AppError("receiptAllocations.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    if (!await tx.payment.findFirst({ where: { companyId: actor.companyId, id: paymentId, direction: "RECEIVED", ledger: "RECEIVABLE" }, select: { id: true } })) throw new AppError("receiptAllocations.paymentNotFound");
    const where = { companyId: actor.companyId, paymentId, salesDocumentId: { not: null } };
    const total = await tx.paymentAllocation.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / RECEIPT_ALLOCATIONS_PER_PAGE));
    const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1), pageCount);
    const rows = await tx.paymentAllocation.findMany({ where, select: { id: true, salesDocumentId: true, amountCents: true, appliedDate: true, unappliedDate: true, salesDocument: { select: { number: true } } }, orderBy: [{ appliedDate: "desc" }, { id: "desc" }], skip: (page - 1) * RECEIPT_ALLOCATIONS_PER_PAGE, take: RECEIPT_ALLOCATIONS_PER_PAGE });
    return { allocations: rows.map(row => ({ id: row.id, invoiceId: row.salesDocumentId!, invoiceNumber: row.salesDocument?.number ?? "", amountCents: row.amountCents, appliedDate: iso(row.appliedDate), unappliedDate: row.unappliedDate ? iso(row.unappliedDate) : null })), total, page, pageCount };
  });
}
