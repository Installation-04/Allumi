import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { createBankEntry, memoSchema } from "@/modules/ledger";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { categorizeLines, MAX_MATCHED_LINES, matchProblem, TRANSFER_DAYS, transferLines, transferProblem } from "../domain/matching";
import { cleanText } from "../domain/statement";
import { entryNumberFormat, lineSelect, toLineDto, type LedgerLineDto } from "./match-read";
import type { TransactionStatus } from "./transactions";

/** The widest window the candidates can be asked for, in days either side of the transaction. */
export const MAX_CANDIDATE_DAYS = 365;
export const DEFAULT_CANDIDATE_DAYS = 45;
const CANDIDATES_SHOWN = 200;
const TRANSFERS_SHOWN = 10;

const idSchema = z.uuid();
const memoInput = z.string().max(2000).nullish();

type Locked = { id: string; accountId: string; amountCents: bigint; status: TransactionStatus; currency: string; txnDate: Date; description: string };
type LockedRow = { id: string; account_id: string; amount_cents: bigint; status: TransactionStatus; currency: string; txn_date: Date; description: string };

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** The transactions, locked in id order so two requests that touch the same pair cannot wait on each other. */
async function lockTransactions(tx: Tx, companyId: string, ids: string[]): Promise<Locked[]> {
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id, account_id, amount_cents, status::text AS status, currency, txn_date, description
      FROM bank_transaction
     WHERE company_id = ${companyId}::uuid AND id = ANY(${ids}::uuid[])
     ORDER BY id FOR UPDATE`;
  return rows.map((row) => ({ id: row.id, accountId: row.account_id, amountCents: row.amount_cents, status: row.status, currency: row.currency, txnDate: row.txn_date, description: row.description }));
}

async function lockOne(tx: Tx, companyId: string, id: string): Promise<Locked> {
  const [row] = await lockTransactions(tx, companyId, [id]);
  if (!row) throw new AppError("banking.transactionNotFound");
  return row;
}

/** Only Canadian-dollar lines are matched or recorded: the books are in one currency. */
function requireUnmatchedCad(row: Locked): void {
  if (row.status !== "UNMATCHED") throw new AppError("banking.notUnmatched");
  if (row.currency !== "CAD") throw new AppError("banking.currency");
}

/** Links the transaction to ledger lines and marks it matched; the database re-checks the sum when the rules fire. */
async function attach(tx: Tx, companyId: string, transactionId: string, lineIds: string[]): Promise<void> {
  await tx.bankMatch.createMany({ data: lineIds.map((journalLineId) => ({ companyId, bankTransactionId: transactionId, journalLineId })) });
  await tx.bankTransaction.updateMany({ where: { companyId, id: transactionId }, data: { status: "MATCHED" } });
}

/** Fires the deferred rules (sum of the matches, balance of a new entry) here, where their refusal can be told apart, not at commit. */
async function settle(tx: Tx): Promise<void> {
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
}

async function failing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // A line another request matched first hits the unique link.
    if (isConflict(error)) throw new AppError("banking.lineTaken");
    throw toAppError(error);
  }
}

// ------------------------------------------------------------------------------------------------ reading

/**
 * The ledger lines on a transaction's account that could be it: not matched, dated within the window (45 days either
 * side by default), the closest first. A reversal and the entry it cancels are listed but flagged, as are the lines a
 * reconciliation already counted.
 */
export async function listMatchCandidates(actor: CompanyContext, transactionId: string, options: { days?: number } = {}): Promise<LedgerLineDto[]> {
  if (!idSchema.safeParse(transactionId).success) throw new AppError("banking.transactionNotFound");
  const days = Math.min(Math.max(1, Math.trunc(options.days ?? DEFAULT_CANDIDATE_DAYS) || DEFAULT_CANDIDATE_DAYS), MAX_CANDIDATE_DAYS);
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const txn = await tx.bankTransaction.findFirst({ where: { companyId: actor.companyId, id: transactionId }, select: { accountId: true, txnDate: true } });
    if (!txn) throw new AppError("banking.transactionNotFound");
    const from = new Date(txn.txnDate.getTime() - days * 86_400_000);
    const to = new Date(txn.txnDate.getTime() + days * 86_400_000);
    const rows = await tx.journalLine.findMany({
      where: { companyId: actor.companyId, accountId: txn.accountId, entryDate: { gte: from, lte: to }, bankMatch: null },
      select: lineSelect,
      orderBy: [{ entryDate: "asc" }, { entryId: "asc" }, { lineNo: "asc" }],
      take: CANDIDATES_SHOWN * 4,
    });
    const format = await entryNumberFormat(tx, actor.companyId);
    const target = txn.txnDate.getTime();
    return rows
      .sort((a, b) => Math.abs(a.entryDate.getTime() - target) - Math.abs(b.entryDate.getTime() - target) || Number(a.entry.entryNumber - b.entry.entryNumber))
      .slice(0, CANDIDATES_SHOWN)
      .map((row) => toLineDto(row, format));
  });
}

export type TransferCandidate = { id: string; date: string; description: string; amountCents: bigint; accountId: string; accountCode: string; accountNameFr: string; accountNameEn: string };

/** The other side of a transfer: an unmatched line on another bank, card or cash account, the opposite amount, within a week. */
export async function listTransferCandidates(actor: CompanyContext, transactionId: string): Promise<TransferCandidate[]> {
  if (!idSchema.safeParse(transactionId).success) throw new AppError("banking.transactionNotFound");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const txn = await tx.bankTransaction.findFirst({ where: { companyId: actor.companyId, id: transactionId }, select: { accountId: true, txnDate: true, amountCents: true, currency: true, status: true } });
    if (!txn) throw new AppError("banking.transactionNotFound");
    if (txn.status !== "UNMATCHED") return [];
    const rows = await tx.bankTransaction.findMany({
      where: {
        companyId: actor.companyId, status: "UNMATCHED", currency: txn.currency, amountCents: -txn.amountCents, accountId: { not: txn.accountId },
        txnDate: { gte: new Date(txn.txnDate.getTime() - TRANSFER_DAYS * 86_400_000), lte: new Date(txn.txnDate.getTime() + TRANSFER_DAYS * 86_400_000) },
      },
      select: { id: true, txnDate: true, description: true, amountCents: true, accountId: true, account: { select: { code: true, nameFr: true, nameEn: true } } },
      take: 50,
    });
    const target = txn.txnDate.getTime();
    return rows
      .sort((a, b) => Math.abs(a.txnDate.getTime() - target) - Math.abs(b.txnDate.getTime() - target) || a.id.localeCompare(b.id))
      .slice(0, TRANSFERS_SHOWN)
      .map((row) => ({ id: row.id, date: isoDay(row.txnDate), description: row.description, amountCents: row.amountCents, accountId: row.accountId, accountCode: row.account.code, accountNameFr: row.account.nameFr, accountNameEn: row.account.nameEn }));
  });
}

// ------------------------------------------------------------------------------------------------ matching

/**
 * Matches an unmatched transaction to existing ledger lines on its account (owner and accountant). Together they must
 * move exactly the amount of the transaction: one line for a payment, several when the bank grouped them (a deposit of
 * three cheques) or took a fee out of it. A line is matched to one transaction only.
 */
export async function matchTransaction(actor: CompanyContext, transactionId: string, lineIds: readonly string[]): Promise<void> {
  const ids = z.array(idSchema).max(MAX_MATCHED_LINES + 1).safeParse(lineIds);
  if (!idSchema.safeParse(transactionId).success || !ids.success) throw new AppError("banking.invalid");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const txn = await lockOne(tx, actor.companyId, transactionId);
      requireUnmatchedCad(txn);
      const lines = await tx.journalLine.findMany({
        where: { companyId: actor.companyId, id: { in: ids.data }, accountId: txn.accountId },
        select: { id: true, debitCents: true, creditCents: true },
      });
      if (lines.length !== new Set(ids.data).size) throw new AppError("banking.lineNotFound");
      const problem = matchProblem(txn.amountCents, ids.data.map((id) => {
        const line = lines.find((row) => row.id === id);
        return { id, cents: line ? line.debitCents - line.creditCents : 0n };
      }));
      if (problem) throw new AppError(`banking.${{ empty: "noLines", tooMany: "tooManyLines", duplicate: "invalid", sum: "sumMismatch" }[problem]}`);
      await attach(tx, actor.companyId, txn.id, ids.data);
      await settle(tx);
    }),
  );
}

/**
 * Undoes a match (owner and accountant): the transaction waits again, and the ledger lines it was matched to are free
 * for another. Refused while a reconciliation counts one of the lines (reopen it first). The ledger is not touched: an
 * entry that was made from the transaction stays, and is reversed from the ledger if it was wrong.
 */
export async function unmatchTransaction(actor: CompanyContext, transactionId: string): Promise<void> {
  if (!idSchema.safeParse(transactionId).success) throw new AppError("banking.transactionNotFound");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const txn = await lockOne(tx, actor.companyId, transactionId);
      if (txn.status !== "MATCHED") throw new AppError("banking.notMatched");
      const matches = await tx.bankMatch.findMany({ where: { companyId: actor.companyId, bankTransactionId: txn.id }, select: { journalLineId: true } });
      const reconciled = await tx.reconciledLine.count({ where: { companyId: actor.companyId, journalLineId: { in: matches.map((match) => match.journalLineId) } } });
      if (reconciled > 0) throw new AppError("banking.lineReconciled");
      await tx.bankMatch.deleteMany({ where: { companyId: actor.companyId, bankTransactionId: txn.id } });
      await tx.bankTransaction.updateMany({ where: { companyId: actor.companyId, id: txn.id }, data: { status: "UNMATCHED" } });
      await settle(tx);
    }),
  );
}

// ------------------------------------------------------------------------------------------------ recording

/** An entry already made from this line and not cancelled since: a second one would count the same money twice. */
async function alreadyRecorded(tx: Tx, companyId: string, transactionId: string): Promise<boolean> {
  const entries = await tx.journalEntry.findMany({ where: { companyId, sourceType: "BANK", sourceId: transactionId }, select: { reversedBy: { select: { id: true } } } });
  return entries.some((entry) => entry.reversedBy === null);
}

function memoOf(input: string | null | undefined, fallback: string): string | null {
  const text = cleanText(input ?? "", 500) || cleanText(fallback, 500);
  return memoSchema.safeParse(text).success && text ? text : null;
}

/**
 * Records an unmatched transaction against another account (owner and accountant, who may post entries): money in
 * debits the statement's account and credits the other one, money out the reverse. The entry is dated like the
 * transaction and keeps its description, and the new line on the statement's account is matched to it. Refused if an
 * entry already stands for this transaction (match it instead).
 */
export async function categorizeTransaction(actor: CompanyContext, transactionId: string, input: { accountId: string; memo?: string | null }): Promise<{ entryId: string; entryNumber: bigint }> {
  const parsed = z.object({ transactionId: idSchema, accountId: idSchema, memo: memoInput }).safeParse({ transactionId, accountId: input.accountId, memo: input.memo });
  if (!parsed.success) throw new AppError("banking.invalid");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const txn = await lockOne(tx, actor.companyId, transactionId);
      requireUnmatchedCad(txn);
      if (parsed.data.accountId === txn.accountId) throw new AppError("banking.sameAccount");
      if (await alreadyRecorded(tx, actor.companyId, txn.id)) throw new AppError("banking.alreadyRecorded");
      const description = cleanText(txn.description, 200) || null;
      const entry = await createBankEntry(tx, actor, {
        transactionId: txn.id,
        date: isoDay(txn.txnDate),
        memo: memoOf(parsed.data.memo, txn.description),
        lines: categorizeLines(txn.amountCents, txn.accountId, parsed.data.accountId, description),
      });
      const own = entry.lines.find((line) => line.accountId === txn.accountId);
      if (!own) throw new AppError("banking.invalid");
      await attach(tx, actor.companyId, txn.id, [own.id]);
      await settle(tx);
      return { entryId: entry.id, entryNumber: entry.number };
    }),
  );
}

/**
 * Records two unmatched transactions as one transfer between two of the company's accounts (a Stripe payout and the
 * deposit it made at the bank, a payment to the credit card): one entry, dated the earlier of the two, with a line on
 * each account, and each transaction matched to its own line. They must be on different accounts and cancel out.
 */
export async function createTransfer(actor: CompanyContext, input: { transactionId: string; otherTransactionId: string; memo?: string | null }): Promise<{ entryId: string; entryNumber: bigint }> {
  const parsed = z.object({ transactionId: idSchema, otherTransactionId: idSchema, memo: memoInput }).safeParse(input);
  if (!parsed.success || parsed.data.transactionId === parsed.data.otherTransactionId) throw new AppError("banking.invalid");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const locked = await lockTransactions(tx, actor.companyId, [parsed.data.transactionId, parsed.data.otherTransactionId]);
      const first = locked.find((row) => row.id === parsed.data.transactionId);
      const second = locked.find((row) => row.id === parsed.data.otherTransactionId);
      if (!first || !second) throw new AppError("banking.transactionNotFound");
      requireUnmatchedCad(first);
      requireUnmatchedCad(second);
      const problem = transferProblem(first, second);
      if (problem) throw new AppError(problem === "sameAccount" ? "banking.transferAccount" : "banking.transferAmounts");
      if ((await alreadyRecorded(tx, actor.companyId, first.id)) || (await alreadyRecorded(tx, actor.companyId, second.id))) throw new AppError("banking.alreadyRecorded");
      const date = first.txnDate <= second.txnDate ? first.txnDate : second.txnDate;
      const entry = await createBankEntry(tx, actor, {
        transactionId: first.id,
        date: isoDay(date),
        memo: memoOf(parsed.data.memo, first.description),
        lines: transferLines(first, second, cleanText(first.description, 200) || null),
      });
      const lineOn = (accountId: string) => entry.lines.find((line) => line.accountId === accountId);
      const firstLine = lineOn(first.accountId);
      const secondLine = lineOn(second.accountId);
      if (!firstLine || !secondLine) throw new AppError("banking.invalid");
      await attach(tx, actor.companyId, first.id, [firstLine.id]);
      await attach(tx, actor.companyId, second.id, [secondLine.id]);
      await settle(tx);
      return { entryId: entry.id, entryNumber: entry.number };
    }),
  );
}
