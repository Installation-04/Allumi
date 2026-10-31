import "server-only";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/modules/companies";
import { createPaymentEntry, createPaymentReversal, formatNumber, isValidIsoDate, todayIso, type EntryLine } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { acceptsDisbursements, disbursementSchema, receiptVoidSchema } from "../domain/disbursement";

export const DISBURSEMENTS_PER_PAGE = 25;

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Records a payment received from a supplier and applies it in full to one posted bill, in one transaction:
 * the journal entry (money in on the chosen account, payables down for the supplier), the payment with its
 * gap-free number, and the allocation. The database checks everything again at commit (balance, contact, period,
 * allocation within the open balance of the bill).
 *
 * The bill row is locked first, so two payments for the same bill are applied one after the other; the amount
 * the person reviewed (`expectedOpenCents`) must still be the open balance, which also refuses a form submitted twice.
 */
export async function recordDisbursement(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string; number: string }> {
  try {
    return await withCompany(actor, (tx) => recordDisbursementWithin(tx, actor, input, options));
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * The same, inside the caller's transaction: for an operation that must commit together with a receipt (a payment
 * collected online records the receipt and its fee as one). The caller maps database rules with `toAppError`.
 */
export async function recordDisbursementWithin(tx: Tx, actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string; number: string }> {
  const parsed = disbursementSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("disbursements.invalid");
  const { billId, amountCents, expectedOpenCents, date, accountId, method, reference, memo } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("disbursements.futureDate");
  await requireRole(tx, "entry.post");
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM purchase_document WHERE company_id = ${actor.companyId}::uuid AND id = ${billId}::uuid AND kind = 'BILL' FOR UPDATE`;
  if (!locked[0]) throw new AppError("disbursements.billNotFound");
  const bill = await tx.purchaseDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id: billId }, select: { number: true, status: true, contactId: true, postingDate: true } });
  if (!bill.contactId) throw new AppError("disbursements.billNotFound");
  if (bill.status !== "POSTED") throw new AppError("disbursements.billNotOpen");
  if (date < iso(bill.postingDate)) throw new AppError("disbursements.dateBeforeBill");

  const open = await tx.$queryRaw<{ cents: bigint }[]>`SELECT purchase_document_open_cents(${actor.companyId}::uuid, ${billId}::uuid) AS cents`;
  const openCents = open[0]?.cents ?? 0n;
  if (openCents !== expectedOpenCents) throw new AppError("disbursements.stale");
  if (amountCents > openCents) throw new AppError("disbursements.exceeds");

  const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId }, select: { subtype: true, systemKey: true, isActive: true } });
  if (!account || !acceptsDisbursements(account)) throw new AppError("disbursements.account");
  const payable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_PAYABLE", isActive: true }, select: { id: true } });
  if (!payable) throw new AppError("ledger.notInitialized");

  const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`
    UPDATE number_sequence SET next_value = next_value + 1
     WHERE company_id = ${actor.companyId}::uuid AND key = 'PAYMENT_SENT'::sequence_key
 RETURNING next_value - 1 AS n, prefix, padding`;
  if (!sequence[0]) throw new AppError("ledger.notInitialized");
  const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);

  const id = randomUUID();
  const lines: EntryLine[] = [
    { accountId, debitCents: 0n, creditCents: amountCents },
    { accountId: payable.id, debitCents: amountCents, creditCents: 0n, contactId: bill.contactId },
  ];
  const entry = await createPaymentEntry(tx, actor, { paymentId: id, date, memo: bill.number ? `${number} · ${bill.number}` : number, lines });
  const day = new Date(`${date}T00:00:00Z`);
  await tx.payment.create({
    data: {
      id, companyId: actor.companyId, direction: "SENT", ledger: "PAYABLE", number, contactId: bill.contactId, paymentDate: day,
      amountCents, accountId, method, reference, memo, journalEntryId: entry.id, createdById: actor.userId,
    },
  });
  await tx.paymentAllocation.create({ data: { companyId: actor.companyId, paymentId: id, purchaseDocumentId: billId, amountCents, appliedDate: day, createdById: actor.userId } });
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  return { id, number };
}

/**
 * Voids a payment: its allocations are released, its entry is reversed on `date` (never before the payment) and it
 * stays on file with the reason. The bill's open balance comes back. A second call returns the same payment.
 */
export async function voidDisbursement(actor: CompanyContext, id: string, input: unknown): Promise<string> {
  const parsed = receiptVoidSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("disbursements.invalidVoid");
  const { date, reason } = parsed.data;
  try {
    return await withCompany(actor, async (tx) => {
      await requireRole(tx, "entry.post");
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payment WHERE company_id = ${actor.companyId}::uuid AND id = ${id}::uuid AND direction = 'SENT' AND ledger = 'PAYABLE' FOR UPDATE`;
      if (!locked[0]) throw new AppError("disbursements.notFound");
      const payment = await tx.payment.findFirstOrThrow({ where: { companyId: actor.companyId, id } });
      if (payment.status === "VOID") return id;
      const allocations = await tx.paymentAllocation.findMany({ where: { companyId: actor.companyId, paymentId: id, unappliedDate: null }, select: { id: true, appliedDate: true } });
      const latest = allocations.reduce((max, allocation) => (iso(allocation.appliedDate) > max ? iso(allocation.appliedDate) : max), iso(payment.paymentDate));
      if (date < latest) throw new AppError("disbursements.invalidVoid");

      // Bills first, in a fixed order: a concurrent bill void or payment waits instead of crossing.
      await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id = ${actor.companyId}::uuid AND id IN (SELECT purchase_document_id FROM payment_allocation WHERE company_id = ${actor.companyId}::uuid AND payment_id = ${id}::uuid) ORDER BY id FOR UPDATE`;
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

/** The accounts a supplier's money can be received into, in chart order. */
export async function listDisbursementAccounts(actor: CompanyContext) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const accounts = await tx.account.findMany({
      where: { companyId: actor.companyId, isActive: true, subtype: { in: ["BANK", "CASH", "CREDIT_CARD"] } },
      select: { id: true, code: true, nameFr: true, nameEn: true, subtype: true, systemKey: true, isActive: true },
      orderBy: { code: "asc" },
    });
    return accounts.filter(acceptsDisbursements);
  });
}

/** The payments applied to an bill right now (a voided payment no longer is), oldest first. */
export async function listBillPayments(actor: CompanyContext, billId: string) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const allocations = await tx.paymentAllocation.findMany({
      where: { companyId: actor.companyId, purchaseDocumentId: billId, unappliedDate: null },
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

export async function listDisbursements(actor: CompanyContext, requestedPage = 1) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const where = { companyId: actor.companyId, direction: "SENT", ledger: "PAYABLE" } as const;
    const total = await tx.payment.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / DISBURSEMENTS_PER_PAGE));
    const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
    const rows = await tx.payment.findMany({
      where,
      select: {
        id: true, number: true, paymentDate: true, amountCents: true, status: true, method: true, reference: true,
        contact: { select: { displayName: true } },
        allocations: { select: { purchaseDocument: { select: { id: true, number: true } } }, orderBy: { id: "asc" } },
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * DISBURSEMENTS_PER_PAGE,
      take: DISBURSEMENTS_PER_PAGE,
    });
    const receipts = rows.map((row) => ({
      id: row.id, number: row.number ?? "", date: iso(row.paymentDate), amountCents: row.amountCents, status: row.status, method: row.method, reference: row.reference,
      supplier: row.contact.displayName,
      bills: [...new Map(row.allocations.flatMap((a) => (a.purchaseDocument ? [[a.purchaseDocument.id, a.purchaseDocument.number ?? ""] as const] : []))).entries()].map(([billId, number]) => ({ id: billId, number })),
    }));
    return { receipts, total, page, pageCount };
  });
}

export async function getDisbursement(actor: CompanyContext, id: string) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const row = await tx.payment.findFirst({
      where: { companyId: actor.companyId, id, direction: "SENT", ledger: "PAYABLE" },
      include: {
        contact: { select: { displayName: true } },
        account: { select: { code: true, nameFr: true, nameEn: true } },
        voidEntry: { select: { entryDate: true } },
        allocations: { orderBy: [{ appliedDate: "asc" }, { id: "asc" }], select: { id: true, amountCents: true, appliedDate: true, unappliedDate: true, purchaseDocument: { select: { id: true, number: true } } } },
      },
    });
    if (!row) return null;
    return {
      id: row.id, number: row.number ?? "", date: iso(row.paymentDate), amountCents: row.amountCents, status: row.status, method: row.method,
      reference: row.reference, memo: row.memo, supplier: row.contact.displayName, contactId: row.contactId, account: row.account,
      journalEntryId: row.journalEntryId, voidEntryId: row.voidEntryId, voidDate: row.voidEntry ? iso(row.voidEntry.entryDate) : null, voidReason: row.voidReason,
      allocations: row.allocations.map((a) => ({
        id: a.id, amountCents: a.amountCents, appliedDate: iso(a.appliedDate), unappliedDate: a.unappliedDate ? iso(a.unappliedDate) : null,
        billId: a.purchaseDocument?.id ?? "", billNumber: a.purchaseDocument?.number ?? "",
      })),
    };
  });
}
