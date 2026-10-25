import "server-only";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/modules/companies";
import { createPaymentEntry, createPaymentReversal, formatNumber, isValidIsoDate, todayIso, type EntryLine } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { acceptsReceipts, receiptSchema, receiptVoidSchema } from "../domain/receipt";

export const RECEIPTS_PER_PAGE = 25;

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Records a payment received from a customer and applies it in full to one posted invoice, in one transaction:
 * the journal entry (money in on the chosen account, receivables down for the customer), the payment with its
 * gap-free number, and the allocation. The database checks everything again at commit (balance, contact, period,
 * allocation within the open balance of the invoice).
 *
 * The invoice row is locked first, so two payments for the same invoice are applied one after the other; the amount
 * the person reviewed (`expectedOpenCents`) must still be the open balance, which also refuses a form submitted twice.
 */
export async function recordReceipt(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string; number: string }> {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("payments.invalid");
  const { invoiceId, amountCents, expectedOpenCents, date, accountId, method, reference, memo } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("payments.futureDate");
  try {
    return await withCompany(actor, async (tx) => {
      await requireRole(tx, "sales.manage");
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sales_document WHERE company_id = ${actor.companyId}::uuid AND id = ${invoiceId}::uuid AND kind = 'INVOICE' FOR UPDATE`;
      if (!locked[0]) throw new AppError("payments.invoiceNotFound");
      const invoice = await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id: invoiceId }, select: { number: true, status: true, contactId: true, postingDate: true } });
      if (invoice.status !== "POSTED") throw new AppError("payments.invoiceNotOpen");
      if (date < iso(invoice.postingDate)) throw new AppError("payments.dateBeforeInvoice");

      const open = await tx.$queryRaw<{ cents: bigint }[]>`SELECT sales_document_open_cents(${actor.companyId}::uuid, ${invoiceId}::uuid) AS cents`;
      const openCents = open[0]?.cents ?? 0n;
      if (openCents !== expectedOpenCents) throw new AppError("payments.stale");
      if (amountCents > openCents) throw new AppError("payments.exceeds");

      const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId }, select: { subtype: true, systemKey: true, isActive: true } });
      if (!account || !acceptsReceipts(account)) throw new AppError("payments.account");
      const receivable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_RECEIVABLE", isActive: true }, select: { id: true } });
      if (!receivable) throw new AppError("ledger.notInitialized");

      const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`
        UPDATE number_sequence SET next_value = next_value + 1
         WHERE company_id = ${actor.companyId}::uuid AND key = 'PAYMENT_RECEIVED'::sequence_key
     RETURNING next_value - 1 AS n, prefix, padding`;
      if (!sequence[0]) throw new AppError("ledger.notInitialized");
      const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);

      const id = randomUUID();
      const lines: EntryLine[] = [
        { accountId, debitCents: amountCents, creditCents: 0n },
        { accountId: receivable.id, debitCents: 0n, creditCents: amountCents, contactId: invoice.contactId },
      ];
      const entry = await createPaymentEntry(tx, actor, { paymentId: id, date, memo: invoice.number ? `${number} · ${invoice.number}` : number, lines });
      const day = new Date(`${date}T00:00:00Z`);
      await tx.payment.create({
        data: {
          id, companyId: actor.companyId, direction: "RECEIVED", ledger: "RECEIVABLE", number, contactId: invoice.contactId, paymentDate: day,
          amountCents, accountId, method, reference, memo, journalEntryId: entry.id, createdById: actor.userId,
        },
      });
      await tx.paymentAllocation.create({ data: { companyId: actor.companyId, paymentId: id, salesDocumentId: invoiceId, amountCents, appliedDate: day, createdById: actor.userId } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return { id, number };
    });
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Voids a payment: its allocations are released, its entry is reversed on `date` (never before the payment) and it
 * stays on file with the reason. The invoice's open balance comes back. A second call returns the same payment.
 */
export async function voidReceipt(actor: CompanyContext, id: string, input: unknown): Promise<string> {
  const parsed = receiptVoidSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("payments.invalidVoid");
  const { date, reason } = parsed.data;
  try {
    return await withCompany(actor, async (tx) => {
      await requireRole(tx, "sales.manage");
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payment WHERE company_id = ${actor.companyId}::uuid AND id = ${id}::uuid AND direction = 'RECEIVED' AND ledger = 'RECEIVABLE' FOR UPDATE`;
      if (!locked[0]) throw new AppError("payments.notFound");
      const payment = await tx.payment.findFirstOrThrow({ where: { companyId: actor.companyId, id } });
      if (payment.status === "VOID") return id;
      const allocations = await tx.paymentAllocation.findMany({ where: { companyId: actor.companyId, paymentId: id, unappliedDate: null }, select: { id: true, appliedDate: true } });
      const latest = allocations.reduce((max, allocation) => (iso(allocation.appliedDate) > max ? iso(allocation.appliedDate) : max), iso(payment.paymentDate));
      if (date < latest) throw new AppError("payments.invalidVoid");

      // Invoices first, in a fixed order: a concurrent invoice void or payment waits instead of crossing.
      await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id = ${actor.companyId}::uuid AND id IN (SELECT sales_document_id FROM payment_allocation WHERE company_id = ${actor.companyId}::uuid AND payment_id = ${id}::uuid) ORDER BY id FOR UPDATE`;
      await tx.paymentAllocation.updateMany({ where: { companyId: actor.companyId, paymentId: id, unappliedDate: null }, data: { unappliedDate: new Date(`${date}T00:00:00Z`), unappliedById: actor.userId } });
      const reversal = await createPaymentReversal(tx, actor, { paymentId: id, entryId: payment.journalEntryId, date, memo: reason });
      await tx.payment.update({ where: { companyId_id: { companyId: actor.companyId, id } }, data: { status: "VOID", voidEntryId: reversal.id, voidedAt: new Date(), voidedById: actor.userId, voidReason: reason } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) {
    throw toAppError(error);
  }
}

/** The accounts a customer's money can be received into, in chart order. */
export async function listReceiptAccounts(actor: CompanyContext) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    const accounts = await tx.account.findMany({
      where: { companyId: actor.companyId, isActive: true, OR: [{ subtype: { in: ["BANK", "CASH"] } }, { systemKey: "UNDEPOSITED_FUNDS" }] },
      select: { id: true, code: true, nameFr: true, nameEn: true, subtype: true, systemKey: true, isActive: true },
      orderBy: { code: "asc" },
    });
    return accounts.filter(acceptsReceipts);
  });
}

/** The payments applied to an invoice right now (a voided payment no longer is), oldest first. */
export async function listInvoicePayments(actor: CompanyContext, invoiceId: string) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    const allocations = await tx.paymentAllocation.findMany({
      where: { companyId: actor.companyId, salesDocumentId: invoiceId, unappliedDate: null },
      select: { id: true, amountCents: true, appliedDate: true, payment: { select: { id: true, number: true, method: true, reference: true, paymentDate: true } } },
      orderBy: [{ appliedDate: "asc" }, { id: "asc" }],
      take: 200,
    });
    return allocations.map((allocation) => ({
      allocationId: allocation.id, paymentId: allocation.payment.id, number: allocation.payment.number ?? "", method: allocation.payment.method,
      reference: allocation.payment.reference, date: iso(allocation.payment.paymentDate), amountCents: allocation.amountCents,
    }));
  });
}

export async function listReceipts(actor: CompanyContext, requestedPage = 1) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    const where = { companyId: actor.companyId, direction: "RECEIVED", ledger: "RECEIVABLE" } as const;
    const total = await tx.payment.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / RECEIPTS_PER_PAGE));
    const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
    const rows = await tx.payment.findMany({
      where,
      select: {
        id: true, number: true, paymentDate: true, amountCents: true, status: true, method: true, reference: true,
        contact: { select: { displayName: true } },
        allocations: { select: { salesDocument: { select: { id: true, number: true } } }, orderBy: { id: "asc" } },
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * RECEIPTS_PER_PAGE,
      take: RECEIPTS_PER_PAGE,
    });
    const receipts = rows.map((row) => ({
      id: row.id, number: row.number ?? "", date: iso(row.paymentDate), amountCents: row.amountCents, status: row.status, method: row.method, reference: row.reference,
      customer: row.contact.displayName,
      invoices: [...new Map(row.allocations.flatMap((a) => (a.salesDocument ? [[a.salesDocument.id, a.salesDocument.number ?? ""] as const] : []))).entries()].map(([invoiceId, number]) => ({ id: invoiceId, number })),
    }));
    return { receipts, total, page, pageCount };
  });
}

export async function getReceipt(actor: CompanyContext, id: string) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    const row = await tx.payment.findFirst({
      where: { companyId: actor.companyId, id, direction: "RECEIVED", ledger: "RECEIVABLE" },
      include: {
        contact: { select: { displayName: true } },
        account: { select: { code: true, nameFr: true, nameEn: true } },
        voidEntry: { select: { entryDate: true } },
        allocations: { orderBy: [{ appliedDate: "asc" }, { id: "asc" }], select: { id: true, amountCents: true, appliedDate: true, unappliedDate: true, salesDocument: { select: { id: true, number: true } } } },
      },
    });
    if (!row) return null;
    return {
      id: row.id, number: row.number ?? "", date: iso(row.paymentDate), amountCents: row.amountCents, status: row.status, method: row.method,
      reference: row.reference, memo: row.memo, customer: row.contact.displayName, contactId: row.contactId, account: row.account,
      journalEntryId: row.journalEntryId, voidEntryId: row.voidEntryId, voidDate: row.voidEntry ? iso(row.voidEntry.entryDate) : null, voidReason: row.voidReason,
      allocations: row.allocations.map((a) => ({
        id: a.id, amountCents: a.amountCents, appliedDate: iso(a.appliedDate), unappliedDate: a.unappliedDate ? iso(a.unappliedDate) : null,
        invoiceId: a.salesDocument?.id ?? "", invoiceNumber: a.salesDocument?.number ?? "",
      })),
    };
  });
}
