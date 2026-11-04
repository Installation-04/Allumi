import "server-only";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/modules/companies";
import {
  createPaymentEntry,
  createPaymentReversal,
  formatNumber,
  isValidIsoDate,
  todayIso,
  type EntryLine,
} from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { acceptsRefunds, refundSchema } from "../domain/refund";
import { receiptVoidSchema } from "../domain/receipt";

import { paymentHistoryWhere } from "./history";
import { assertCustomerMovementDate } from "./movement-dates";

export const CUSTOMER_REFUNDS_PER_PAGE = 25;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const customerName = (snapshot: unknown): string => {
  if (!snapshot || typeof snapshot !== "object" || !("name" in snapshot))
    return "";
  return typeof snapshot.name === "string" ? snapshot.name : "";
};

/** Record a customer refund in the ledger; this does not send money through a bank or processor. */
export async function recordCustomerRefund(
  actor: CompanyContext,
  input: unknown,
  options: { now?: Date } = {},
): Promise<{ id: string; number: string }> {
  try {
    return await withCompany(actor, (tx) =>
      recordCustomerRefundWithin(tx, actor, input, options),
    );
  } catch (error) {
    throw toAppError(error);
  }
}

async function recordCustomerRefundWithin(
  tx: Tx,
  actor: CompanyContext,
  input: unknown,
  options: { now?: Date } = {},
): Promise<{ id: string; number: string }> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date))
    throw new AppError("refunds.invalid");
  const {
    creditNoteId,
    amountCents,
    expectedOpenCents,
    date,
    accountId,
    method,
    reference,
    memo,
  } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("refunds.futureDate");
  await requireRole(tx, "sales.manage");
  await requireRole(tx, "entry.post");
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM sales_document WHERE company_id = ${actor.companyId}::uuid AND id = ${creditNoteId}::uuid AND kind = 'CREDIT_NOTE' FOR UPDATE`;
  if (!locked[0]) throw new AppError("refunds.creditNotFound");
  const credit = await tx.salesDocument.findFirstOrThrow({
    where: { companyId: actor.companyId, id: creditNoteId },
    select: { number: true, status: true, contactId: true, postingDate: true },
  });
  if (!credit.contactId) throw new AppError("refunds.creditNotFound");
  if (credit.status !== "POSTED") throw new AppError("refunds.creditNotOpen");
  if (date < iso(credit.postingDate))
    throw new AppError("refunds.dateBeforeCredit");
  await assertCustomerMovementDate(tx, actor.companyId, creditNoteId, date, "refunds.dateBeforeMovement");

  const open = await tx.$queryRaw<
    { cents: bigint }[]
  >`SELECT sales_document_open_cents(${actor.companyId}::uuid, ${creditNoteId}::uuid) AS cents`;
  const openCents = open[0]?.cents ?? 0n;
  if (openCents !== expectedOpenCents) throw new AppError("refunds.stale");
  if (amountCents > openCents) throw new AppError("refunds.exceeds");

  const account = await tx.account.findFirst({
    where: { companyId: actor.companyId, id: accountId },
    select: { subtype: true, systemKey: true, isActive: true },
  });
  if (!account || !acceptsRefunds(account))
    throw new AppError("refunds.account");
  const receivable = await tx.account.findFirst({
    where: {
      companyId: actor.companyId,
      systemKey: "ACCOUNTS_RECEIVABLE",
      isActive: true,
    },
    select: { id: true },
  });
  if (!receivable) throw new AppError("ledger.notInitialized");

  const sequence = await tx.$queryRaw<
    { n: bigint; prefix: string; padding: number }[]
  >`
    UPDATE number_sequence SET next_value = next_value + 1
     WHERE company_id = ${actor.companyId}::uuid AND key = 'PAYMENT_SENT'::sequence_key
 RETURNING next_value - 1 AS n, prefix, padding`;
  if (!sequence[0]) throw new AppError("ledger.notInitialized");
  const number = formatNumber(
    sequence[0].prefix,
    sequence[0].padding,
    sequence[0].n,
  );

  const id = randomUUID();
  const lines: EntryLine[] = [
    { accountId, debitCents: 0n, creditCents: amountCents },
    {
      accountId: receivable.id,
      debitCents: amountCents,
      creditCents: 0n,
      contactId: credit.contactId,
    },
  ];
  const entry = await createPaymentEntry(tx, actor, {
    paymentId: id,
    date,
    memo: credit.number ? `${number} · ${credit.number}` : number,
    lines,
  });
  const day = new Date(`${date}T00:00:00Z`);
  await tx.payment.create({
    data: {
      id,
      companyId: actor.companyId,
      direction: "SENT",
      ledger: "RECEIVABLE",
      number,
      contactId: credit.contactId,
      paymentDate: day,
      amountCents,
      accountId,
      method,
      reference,
      memo,
      journalEntryId: entry.id,
      createdById: actor.userId,
    },
  });
  await tx.paymentAllocation.create({
    data: {
      companyId: actor.companyId,
      paymentId: id,
      salesDocumentId: creditNoteId,
      amountCents,
      appliedDate: day,
      createdById: actor.userId,
    },
  });
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  return { id, number };
}

/**
 * Voids a payment: its allocations are released, its entry is reversed on `date` (never before the payment) and it
 * stays on file with the reason. The credit's available balance comes back. A second call returns the same payment.
 */
export async function voidCustomerRefund(
  actor: CompanyContext,
  id: string,
  input: unknown,
): Promise<string> {
  const parsed = receiptVoidSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date))
    throw new AppError("refunds.invalidVoid");
  const { date, reason } = parsed.data;
  if (date > todayIso()) throw new AppError("refunds.futureDate");
  try {
    return await withCompany(actor, async (tx) => {
      await requireRole(tx, "sales.manage");
      await requireRole(tx, "entry.post");
      await requireRole(tx, "entry.reverse");
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payment WHERE company_id = ${actor.companyId}::uuid AND id = ${id}::uuid AND direction = 'SENT' AND ledger = 'RECEIVABLE' FOR UPDATE`;
      if (!locked[0]) throw new AppError("refunds.notFound");
      const payment = await tx.payment.findFirstOrThrow({
        where: { companyId: actor.companyId, id },
      });
      if (payment.status === "VOID") return id;
      const allocations = await tx.paymentAllocation.findMany({
        where: {
          companyId: actor.companyId,
          paymentId: id,
          unappliedDate: null,
        },
        select: { id: true, appliedDate: true },
      });
      const latest = allocations.reduce(
        (max, allocation) =>
          iso(allocation.appliedDate) > max ? iso(allocation.appliedDate) : max,
        iso(payment.paymentDate),
      );
      if (date < latest) throw new AppError("refunds.invalidVoid");

      // Credits first, in a fixed order: a concurrent credit void or payment waits instead of crossing.
      const documents = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_document WHERE company_id = ${actor.companyId}::uuid AND id IN (SELECT sales_document_id FROM payment_allocation WHERE company_id = ${actor.companyId}::uuid AND payment_id = ${id}::uuid) ORDER BY id FOR UPDATE`;
      for (const document of documents) await assertCustomerMovementDate(tx, actor.companyId, document.id, date, "refunds.dateBeforeMovement");
      await tx.paymentAllocation.updateMany({
        where: {
          companyId: actor.companyId,
          paymentId: id,
          unappliedDate: null,
        },
        data: {
          unappliedDate: new Date(`${date}T00:00:00Z`),
          unappliedById: actor.userId,
        },
      });
      const reversal = await createPaymentReversal(tx, actor, {
        paymentId: id,
        entryId: payment.journalEntryId,
        date,
        memo: reason,
      });
      await tx.payment.update({
        where: { companyId_id: { companyId: actor.companyId, id } },
        data: {
          status: "VOID",
          voidEntryId: reversal.id,
          voidedAt: new Date(),
          voidedById: actor.userId,
          voidReason: reason,
        },
      });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return id;
    });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Active real bank/cash accounts available for outgoing customer refunds. */
export async function listCustomerRefundAccounts(actor: CompanyContext) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const accounts = await tx.account.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        subtype: { in: ["BANK", "CASH"] },
      },
      select: {
        id: true,
        code: true,
        nameFr: true,
        nameEn: true,
        subtype: true,
        systemKey: true,
        isActive: true,
      },
      orderBy: { code: "asc" },
    });
    return accounts.filter(acceptsRefunds);
  });
}

/** Latest credit refund allocations, including dated releases after reversal. */
export async function listCreditRefunds(
  actor: CompanyContext,
  creditNoteId: string,
) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const allocations = await tx.paymentAllocation.findMany({
      where: {
        companyId: actor.companyId,
        salesDocumentId: creditNoteId,
        payment: { direction: "SENT", ledger: "RECEIVABLE" },
      },
      select: {
        id: true,
        amountCents: true,
        appliedDate: true,
        unappliedDate: true,
        payment: {
          select: {
            id: true,
            number: true,
            method: true,
            reference: true,
            paymentDate: true,
          },
        },
      },
      orderBy: [{ appliedDate: "desc" }, { id: "desc" }],
      take: 200,
    });
    return allocations.map((allocation) => ({
      allocationId: allocation.id,
      paymentId: allocation.payment.id,
      number: allocation.payment.number ?? "",
      method: allocation.payment.method,
      reference: allocation.payment.reference,
      date: iso(allocation.payment.paymentDate),
      amountCents: allocation.amountCents,
      unappliedDate: allocation.unappliedDate
        ? iso(allocation.unappliedDate)
        : null,
    }));
  });
}

export async function listCustomerRefunds(
  actor: CompanyContext,
  requestedPage = 1,
  filters: unknown = {},
) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const where = paymentHistoryWhere(actor.companyId, "SENT", filters);
    const total = await tx.payment.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_REFUNDS_PER_PAGE));
    const page = Math.min(
      Math.max(1, Math.trunc(requestedPage) || 1),
      pageCount,
    );
    const rows = await tx.payment.findMany({
      where,
      select: {
        id: true,
        number: true,
        paymentDate: true,
        amountCents: true,
        status: true,
        method: true,
        reference: true,
        allocations: {
          select: {
            salesDocument: {
              select: { id: true, number: true, billingSnapshot: true },
            },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * CUSTOMER_REFUNDS_PER_PAGE,
      take: CUSTOMER_REFUNDS_PER_PAGE,
    });
    const receipts = rows.map((row) => ({
      id: row.id,
      number: row.number ?? "",
      date: iso(row.paymentDate),
      amountCents: row.amountCents,
      status: row.status,
      method: row.method,
      reference: row.reference,
      customer: customerName(
        row.allocations[0]?.salesDocument?.billingSnapshot,
      ),
      credits: [
        ...new Map(
          row.allocations.flatMap((a) =>
            a.salesDocument
              ? [[a.salesDocument.id, a.salesDocument.number ?? ""] as const]
              : [],
          ),
        ).entries(),
      ].map(([creditNoteId, number]) => ({ id: creditNoteId, number })),
    }));
    return { refunds: receipts, total, page, pageCount };
  });
}

export async function getCustomerRefund(actor: CompanyContext, id: string) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const row = await tx.payment.findFirst({
      where: {
        companyId: actor.companyId,
        id,
        direction: "SENT",
        ledger: "RECEIVABLE",
      },
      include: {
        account: { select: { code: true, nameFr: true, nameEn: true } },
        voidEntry: { select: { entryDate: true } },
        allocations: {
          orderBy: [{ appliedDate: "asc" }, { id: "asc" }],
          select: {
            id: true,
            amountCents: true,
            appliedDate: true,
            unappliedDate: true,
            salesDocument: {
              select: { id: true, number: true, billingSnapshot: true },
            },
          },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      number: row.number ?? "",
      date: iso(row.paymentDate),
      amountCents: row.amountCents,
      status: row.status,
      method: row.method,
      reference: row.reference,
      memo: row.memo,
      customer: customerName(
        row.allocations[0]?.salesDocument?.billingSnapshot,
      ),
      contactId: row.contactId,
      account: row.account,
      journalEntryId: row.journalEntryId,
      voidEntryId: row.voidEntryId,
      voidDate: row.voidEntry ? iso(row.voidEntry.entryDate) : null,
      voidReason: row.voidReason,
      allocations: row.allocations.map((a) => ({
        id: a.id,
        amountCents: a.amountCents,
        appliedDate: iso(a.appliedDate),
        unappliedDate: a.unappliedDate ? iso(a.unappliedDate) : null,
        creditNoteId: a.salesDocument?.id ?? "",
        creditNumber: a.salesDocument?.number ?? "",
      })),
    };
  });
}
