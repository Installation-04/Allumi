import "server-only";
import { requireRole } from "@/modules/companies";
import { createPaymentEntry, formatNumber, isValidIsoDate, todayIso, type EntryLine } from "@/modules/ledger";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { onAccountReceiptSchema } from "../domain/on-account-receipt";
import { acceptsReceipts } from "../domain/receipt";

/** Record an actual receipt on the customer's account, without applying it to an invoice. */
export async function recordOnAccountReceipt(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string; number: string }> {
  const parsed = onAccountReceiptSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("onAccountReceipts.invalid");
  const { submissionId: id, contactId, amountCents, date, accountId, method, reference, memo } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("onAccountReceipts.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      await requireRole(tx, "entry.post");
      await requireRole(tx, "contact.read");
      // Serialize the idempotency lookup with every other on-account submission before consuming a number.
      const sequence = await tx.$queryRaw<{ n: bigint; prefix: string; padding: number }[]>`SELECT next_value AS n,prefix,padding FROM number_sequence WHERE company_id=${actor.companyId}::uuid AND key='PAYMENT_RECEIVED' FOR UPDATE`;
      if (!sequence[0]) throw new AppError("ledger.notInitialized");
      const existing = await tx.payment.findFirst({ where: { companyId: actor.companyId, id } });
      if (existing) {
        if (existing.direction !== "RECEIVED" || existing.ledger !== "RECEIVABLE" || existing.createdById !== actor.userId || existing.contactId !== contactId || existing.amountCents !== amountCents || existing.accountId !== accountId || existing.paymentDate.toISOString().slice(0, 10) !== date || existing.method !== method || existing.reference !== reference || existing.memo !== memo) throw new AppError("onAccountReceipts.idempotency");
        // An allocated or voided receipt remains the result of this submission; never recreate it.
        return { id: existing.id, number: existing.number ?? "" };
      }
      const customer = await tx.contact.findFirst({ where: { companyId: actor.companyId, id: contactId, isCustomer: true, isActive: true, anonymizedAt: null }, select: { id: true } });
      if (!customer) throw new AppError("onAccountReceipts.customer");
      const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId }, select: { subtype: true, systemKey: true, isActive: true } });
      if (!account || !acceptsReceipts(account)) throw new AppError("payments.account");
      const receivable = await tx.account.findFirst({ where: { companyId: actor.companyId, systemKey: "ACCOUNTS_RECEIVABLE", isActive: true }, select: { id: true } });
      if (!receivable) throw new AppError("ledger.notInitialized");
      const number = formatNumber(sequence[0].prefix, sequence[0].padding, sequence[0].n);
      await tx.$executeRaw`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='PAYMENT_RECEIVED'`;
      const lines: EntryLine[] = [
        { accountId, debitCents: amountCents, creditCents: 0n },
        { accountId: receivable.id, debitCents: 0n, creditCents: amountCents, contactId },
      ];
      const entry = await createPaymentEntry(tx, actor, { paymentId: id, date, memo: number, lines });
      await tx.payment.create({ data: { id, companyId: actor.companyId, direction: "RECEIVED", ledger: "RECEIVABLE", number, contactId, paymentDate: new Date(`${date}T00:00:00Z`), amountCents, accountId, method, reference, memo, journalEntryId: entry.id, createdById: actor.userId } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return { id, number };
    });
  } catch (error) {
    if (isConflict(error)) throw new AppError("onAccountReceipts.idempotency");
    throw toAppError(error);
  }
}
