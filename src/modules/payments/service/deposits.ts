import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import {
  createDepositEntry,
  createDepositReversal,
  formatNumber,
  todayIso,
} from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import {
  depositLines,
  depositSchema,
  depositVoidSchema,
  MAX_DEPOSIT_ITEMS,
} from "../domain/deposit";
const iso = (date: Date) => date.toISOString().slice(0, 10);
export const DEPOSITS_PER_PAGE = 25;
export const PENDING_DEPOSITS_PER_PAGE = MAX_DEPOSIT_ITEMS;
const accountSelect = {
  id: true,
  code: true,
  nameFr: true,
  nameEn: true,
} as const;
async function sourceAccount(tx: Tx, companyId: string) {
  const account = await tx.account.findFirst({
    where: { companyId, systemKey: "UNDEPOSITED_FUNDS", isActive: true },
    select: { id: true },
  });
  if (!account) throw new AppError("ledger.notInitialized");
  return account.id;
}
async function lockPayments(tx: Tx, companyId: string, ids: string[]) {
  return tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM payment WHERE company_id=${companyId}::uuid AND id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}
function pageOf(requested: number, total: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  return {
    page: Math.min(Math.max(1, Math.trunc(requested) || 1), pageCount),
    pageCount,
  };
}
const liveDeposit = { deposit: { status: "POSTED" as const } };
export async function listDepositAccounts(actor: CompanyContext) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    return tx.account.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        subtype: { in: ["CASH", "BANK"] },
      },
      select: accountSelect,
      orderBy: { code: "asc" },
    });
  });
}
/** A bounded page of whole receipts, including the earliest date on which a previously voided deposit releases them. */
export async function listPendingDepositReceipts(
  actor: CompanyContext,
  requestedPage = 1,
  query = "",
) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const term = query
      .trim()
      .slice(0, 100)
      .replace(/[\\%_]/g, "\\$&");
    const where = {
      companyId: actor.companyId,
      status: "POSTED" as const,
      direction: "RECEIVED" as const,
      ledger: "RECEIVABLE" as const,
      account: { systemKey: "UNDEPOSITED_FUNDS" as const, isActive: true },
      depositItems: { none: liveDeposit },
      ...(term
        ? {
            OR: [
              { number: { contains: term, mode: "insensitive" as const } },
              { reference: { contains: term, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const total = await tx.payment.count({ where });
    const { page, pageCount } = pageOf(
      requestedPage,
      total,
      PENDING_DEPOSITS_PER_PAGE,
    );
    const rows = await tx.payment.findMany({
      where,
      select: {
        id: true,
        number: true,
        paymentDate: true,
        amountCents: true,
        method: true,
        reference: true,
        depositItems: {
          select: {
            deposit: { select: { voidEntry: { select: { entryDate: true } } } },
          },
        },
      },
      orderBy: [{ paymentDate: "asc" }, { id: "asc" }],
      skip: (page - 1) * PENDING_DEPOSITS_PER_PAGE,
      take: PENDING_DEPOSITS_PER_PAGE,
    });
    return {
      total,
      page,
      pageCount,
      receipts: rows.map((row) => ({
        id: row.id,
        number: row.number ?? "",
        date: iso(row.paymentDate),
        amountCents: row.amountCents,
        method: row.method,
        reference: row.reference,
        eligibleDate: row.depositItems.reduce(
          (last, item) =>
            item.deposit.voidEntry &&
            iso(item.deposit.voidEntry.entryDate) > last
              ? iso(item.deposit.voidEntry.entryDate)
              : last,
          iso(row.paymentDate),
        ),
      })),
    };
  });
}
export async function recordDeposit(actor: CompanyContext, input: unknown) {
  const parsed = depositSchema.safeParse(input);
  if (!parsed.success) throw new AppError("deposits.invalid");
  const { paymentIds, accountId, date, expectedTotalCents, reference } =
    parsed.data;
  if (date > todayIso()) throw new AppError("deposits.future");
  try {
    return await withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const source = await sourceAccount(tx, actor.companyId);
      const account = await tx.account.findFirst({
        where: {
          companyId: actor.companyId,
          id: accountId,
          isActive: true,
          subtype: { in: ["CASH", "BANK"] },
        },
      });
      if (!account || source === accountId)
        throw new AppError("deposits.account");
      if (
        (await lockPayments(tx, actor.companyId, paymentIds)).length !==
        paymentIds.length
      )
        throw new AppError("deposits.stale");
      const payments = await tx.payment.findMany({
        where: { companyId: actor.companyId, id: { in: paymentIds } },
        include: {
          depositItems: {
            include: {
              deposit: {
                select: {
                  status: true,
                  voidEntry: { select: { entryDate: true } },
                },
              },
            },
          },
        },
      });
      if (
        payments.some(
          (p) =>
            p.status !== "POSTED" ||
            p.direction !== "RECEIVED" ||
            p.ledger !== "RECEIVABLE" ||
            p.accountId !== source ||
            p.depositItems.some((i) => i.deposit.status === "POSTED"),
        )
      )
        throw new AppError("deposits.stale");
      if (
        payments.some(
          (p) =>
            iso(p.paymentDate) > date ||
            p.depositItems.some(
              (i) =>
                i.deposit.voidEntry &&
                iso(i.deposit.voidEntry.entryDate) > date,
            ),
        )
      )
        throw new AppError("deposits.date");
      const total = payments.reduce((sum, p) => sum + p.amountCents, 0n);
      if (total !== expectedTotalCents) throw new AppError("deposits.stale");
      const sequence = await tx.$queryRaw<
        { n: bigint; prefix: string; padding: number }[]
      >`UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=${actor.companyId}::uuid AND key='DEPOSIT' RETURNING next_value-1 AS n,prefix,padding`;
      if (!sequence[0]) throw new AppError("ledger.notInitialized");
      const number = formatNumber(
        sequence[0].prefix,
        sequence[0].padding,
        sequence[0].n,
      );
      const id = randomUUID();
      const entry = await createDepositEntry(tx, actor, {
        depositId: id,
        date,
        memo: [number, reference].filter(Boolean).join(" · "),
        lines: depositLines(accountId, source, total),
      });
      await tx.bankDeposit.create({
        data: {
          id,
          companyId: actor.companyId,
          number,
          reference,
          accountId,
          depositDate: new Date(`${date}T00:00:00Z`),
          totalCents: total,
          journalEntryId: entry.id,
          createdById: actor.userId,
        },
      });
      await tx.bankDepositItem.createMany({
        data: [...paymentIds]
          .sort()
          .map((paymentId) => ({
            companyId: actor.companyId,
            depositId: id,
            paymentId,
          })),
      });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return { id, number };
    });
  } catch (error) {
    throw toAppError(error);
  }
}
export async function listDeposits(actor: CompanyContext, requestedPage = 1) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const where = { companyId: actor.companyId };
    const total = await tx.bankDeposit.count({ where });
    const { page, pageCount } = pageOf(requestedPage, total, DEPOSITS_PER_PAGE);
    const rows = await tx.bankDeposit.findMany({
      where,
      include: {
        account: { select: accountSelect },
        _count: { select: { items: true } },
      },
      orderBy: [{ depositDate: "desc" }, { id: "desc" }],
      skip: (page - 1) * DEPOSITS_PER_PAGE,
      take: DEPOSITS_PER_PAGE,
    });
    return {
      total,
      page,
      pageCount,
      deposits: rows.map((row) => ({
        id: row.id,
        number: row.number ?? "",
        date: iso(row.depositDate),
        totalCents: row.totalCents,
        status: row.status,
        reference: row.reference,
        account: row.account,
        count: row._count.items,
      })),
    };
  });
}
export async function getDeposit(actor: CompanyContext, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const row = await tx.bankDeposit.findFirst({
      where: { companyId: actor.companyId, id },
      include: {
        account: { select: accountSelect },
        voidEntry: { select: { entryDate: true } },
        items: {
          include: {
            payment: {
              select: {
                id: true,
                number: true,
                paymentDate: true,
                amountCents: true,
                method: true,
                reference: true,
                status: true,
              },
            },
          },
          orderBy: { paymentId: "asc" },
          take: MAX_DEPOSIT_ITEMS,
        },
      },
    });
    if (!row) return null;
    const linked = await tx.journalLine.count({
      where: {
        companyId: actor.companyId,
        entryId: row.journalEntryId,
        OR: [
          { bankMatch: { isNot: null } },
          { reconciledLine: { isNot: null } },
        ],
      },
    });
    return {
      ...row,
      number: row.number ?? "",
      date: iso(row.depositDate),
      voidDate: row.voidEntry ? iso(row.voidEntry.entryDate) : null,
      linked: linked > 0,
      items: row.items.map((item) => ({
        ...item.payment,
        number: item.payment.number ?? "",
        date: iso(item.payment.paymentDate),
      })),
    };
  });
}
export async function voidDeposit(
  actor: CompanyContext,
  id: string,
  input: unknown,
) {
  const parsed = depositVoidSchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success)
    throw new AppError("deposits.invalidVoid");
  const { date, reason } = parsed.data;
  if (date > todayIso()) throw new AppError("deposits.future");
  try {
    return await withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM bank_deposit WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
      if (!locked[0]) throw new AppError("deposits.notFound");
      const deposit = await tx.bankDeposit.findFirstOrThrow({
        where: { companyId: actor.companyId, id },
        include: { items: { select: { paymentId: true } } },
      });
      if (deposit.status === "VOID") return id;
      if (date < iso(deposit.depositDate))
        throw new AppError("deposits.invalidVoid");
      await lockPayments(
        tx,
        actor.companyId,
        deposit.items.map((i) => i.paymentId),
      );
      const linked = await tx.journalLine.count({
        where: {
          companyId: actor.companyId,
          entryId: deposit.journalEntryId,
          OR: [
            { bankMatch: { isNot: null } },
            { reconciledLine: { isNot: null } },
          ],
        },
      });
      if (linked) throw new AppError("deposits.linked");
      const reversal = await createDepositReversal(tx, actor, {
        depositId: id,
        entryId: deposit.journalEntryId,
        date,
        memo: reason,
      });
      await tx.bankDeposit.update({
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
