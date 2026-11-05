import "server-only";
import { requireRole } from "@/modules/companies";
import { createPaymentEntry, formatNumber, isValidIsoDate, todayIso, type EntryLine } from "@/modules/ledger";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { receiptRefundSchema } from "../domain/receipt-refund";
import { acceptsRefunds } from "../domain/refund";
import { assertReceiptMovementDate } from "./movement-dates";

export const RECEIPT_REFUNDS_PER_PAGE = 25;
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Record money returned to the customer; no bank or processor transfer is initiated. */
export async function recordReceiptRefund(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string; number: string }> {
  const parsed = receiptRefundSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("receiptRefunds.invalid");
  const { submissionId: id, receiptId, expectedOpenCents, amountCents, date, accountId, method, reference, memo } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("receiptRefunds.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      await requireRole(tx, "entry.post");
      const source = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payment WHERE company_id=${actor.companyId}::uuid AND id=${receiptId}::uuid AND direction='RECEIVED' AND ledger='RECEIVABLE' FOR UPDATE`;
      if (!source[0]) throw new AppError("receiptRefunds.receiptNotFound");
      const receipt = await tx.payment.findFirstOrThrow({ where: { companyId: actor.companyId, id: receiptId }, select: { contactId: true, status: true, number: true } });
      // Source before sequence: never hold the sequence while waiting for an existing receipt.
      const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`SELECT next_value AS n,prefix,padding FROM number_sequence WHERE company_id=${actor.companyId}::uuid AND key='PAYMENT_SENT' FOR UPDATE`;
      if (!sequence[0]) throw new AppError("ledger.notInitialized");
      const existing = await tx.payment.findFirst({ where: { companyId: actor.companyId, id }, include: { offsetsAsSent: { select: { receivedPaymentId: true, amountCents: true } }, _count: { select: { allocations: true } } } });
      if (existing) {
        const link = existing.offsetsAsSent[0];
        if (existing.direction !== "SENT" || existing.ledger !== "RECEIVABLE" || existing.createdById !== actor.userId || existing.contactId !== receipt.contactId || existing.amountCents !== amountCents || existing.accountId !== accountId || iso(existing.paymentDate) !== date || existing.method !== method || existing.reference !== reference || existing.memo !== memo || existing.offsetsAsSent.length !== 1 || link?.receivedPaymentId !== receiptId || link.amountCents !== amountCents || existing._count.allocations !== 0) throw new AppError("receiptRefunds.idempotency");
        return { id: existing.id, number: existing.number ?? "" };
      }
      if (receipt.status !== "POSTED") throw new AppError("receiptRefunds.notPosted");
      await assertReceiptMovementDate(tx, actor.companyId, receiptId, date, "receiptRefunds.dateBeforeMovement");
      const balances = await tx.$queryRaw<{ cents: bigint }[]>`SELECT payment_open_cents(${actor.companyId}::uuid,${receiptId}::uuid) AS cents`;
      if (!balances[0] || balances[0].cents !== expectedOpenCents) throw new AppError("receiptRefunds.stale");
      if (amountCents > balances[0].cents) throw new AppError("receiptRefunds.exceeds");
      const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId }, select: { isActive: true, subtype: true } });
      if (!account || !acceptsRefunds(account)) throw new AppError("refunds.account");
      const receivable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_RECEIVABLE", isActive: true }, select: { id: true } });
      if (!receivable) throw new AppError("ledger.notInitialized");
      const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);
      await tx.$executeRaw`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='PAYMENT_SENT'`;
      const lines: EntryLine[] = [{ accountId, debitCents: 0n, creditCents: amountCents }, { accountId: receivable.id, debitCents: amountCents, creditCents: 0n, contactId: receipt.contactId }];
      const entry = await createPaymentEntry(tx, actor, { paymentId: id, date, memo: `${number} · ${receipt.number ?? ""}`, lines });
      const day = new Date(`${date}T00:00:00Z`);
      await tx.payment.create({ data: { id, companyId: actor.companyId, direction: "SENT", ledger: "RECEIVABLE", number, contactId: receipt.contactId, amountCents, paymentDate: day, accountId, method, reference, memo, journalEntryId: entry.id, createdById: actor.userId } });
      await tx.paymentOffset.create({ data: { companyId: actor.companyId, receivedPaymentId: receiptId, sentPaymentId: id, amountCents, appliedDate: day, createdById: actor.userId } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return { id, number };
    });
  } catch (error) {
    if (isConflict(error)) throw new AppError("receiptRefunds.idempotency");
    throw toAppError(error);
  }
}

/** Every original compensation remains visible, including released and multi-source legacy links. */
export async function listReceiptRefunds(actor: CompanyContext, receiptId: string, requestedPage = 1) {
  if (!receiptRefundSchema.shape.receiptId.safeParse(receiptId).success) throw new AppError("receiptRefunds.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    if (!await tx.payment.findFirst({ where: { companyId: actor.companyId, id: receiptId, direction: "RECEIVED", ledger: "RECEIVABLE" }, select: { id: true } })) throw new AppError("receiptRefunds.receiptNotFound");
    const where = { companyId: actor.companyId, receivedPaymentId: receiptId, sentPayment: { direction: "SENT" as const, ledger: "RECEIVABLE" as const } };
    const total = await tx.paymentOffset.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / RECEIPT_REFUNDS_PER_PAGE));
    const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1), pageCount);
    const offsets = await tx.paymentOffset.findMany({ where, select: { id: true, amountCents: true, appliedDate: true, unappliedDate: true, sentPayment: { select: { id: true, number: true, amountCents: true, paymentDate: true, status: true } } }, orderBy: [{ appliedDate: "desc" }, { id: "desc" }], take: RECEIPT_REFUNDS_PER_PAGE, skip: (page - 1) * RECEIPT_REFUNDS_PER_PAGE });
    return { refunds: offsets.map(row => ({ id: row.id, paymentId: row.sentPayment.id, number: row.sentPayment.number ?? "", date: iso(row.sentPayment.paymentDate), amountCents: row.sentPayment.amountCents, offsetCents: row.amountCents, appliedDate: iso(row.appliedDate), unappliedDate: row.unappliedDate ? iso(row.unappliedDate) : null, status: row.sentPayment.status })), total, page, pageCount };
  });
}
