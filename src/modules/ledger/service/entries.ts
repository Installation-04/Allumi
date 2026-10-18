import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import type { Tx } from "@/platform/tenant";
import { acceptsManualEntries } from "../domain/accounts";
import type { IsoDate } from "../domain/dates";
import { checkEntry, reversalLines, type EntryLine, type EntryProblem } from "../domain/entry";
import { formatNumber } from "../domain/numbering";
import { manualEntrySchema, type ManualEntryInput } from "../domain/schemas";
import { fromDbDate, toDbDate, todayIso } from "./dates";
import { inCompany, type Actor } from "./support";

export type JournalSourceKind = "MANUAL" | "OPENING_BALANCE" | "SALES_DOCUMENT" | "PURCHASE_DOCUMENT" | "PAYMENT" | "DEPOSIT" | "BANK" | "TAX_SETTLEMENT" | "REVERSAL";

export type EntryLineDto = {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountNameFr: string;
  accountNameEn: string;
  debitCents: bigint;
  creditCents: bigint;
  description: string | null;
};

export type EntryDto = {
  id: string;
  number: bigint;
  numberLabel: string;
  date: IsoDate;
  source: JournalSourceKind;
  memo: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  createdById: string;
  createdAt: Date;
  totalCents: bigint;
  lines: EntryLineDto[];
};

/** Which AppError key explains a problem found by the domain check (the same messages as the database rules). */
function problemKey(problem: EntryProblem): string {
  switch (problem.code) {
    case "tooFewLines":
      return "AL002";
    case "unbalanced":
      return "AL001";
    default:
      return "ledger.invalidLine";
  }
}

async function numberFormat(tx: Tx, companyId: string): Promise<{ prefix: string; padding: number }> {
  const sequence = await tx.numberSequence.findUnique({ where: { companyId_key: { companyId, key: "JOURNAL_ENTRY" } }, select: { prefix: true, padding: true } });
  return sequence ?? { prefix: "", padding: 0 };
}

/** The next gap-free number: the row lock is held until this transaction ends, so a rollback gives the number back. */
async function nextEntryNumber(tx: Tx, companyId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    UPDATE number_sequence SET next_value = next_value + 1
     WHERE company_id = ${companyId}::uuid AND key = 'JOURNAL_ENTRY'::sequence_key
 RETURNING next_value - 1 AS n`;
  const row = rows[0];
  if (!row) throw new AppError("ledger.notInitialized");
  return row.n;
}

/**
 * The one place that writes to journal_entry and journal_line. The database checks everything again (balance,
 * period, control accounts, mirror of a reversal); the deferred checks are fired here so a refusal surfaces
 * from this call with its code.
 */
async function insertEntry(
  tx: Tx,
  actor: Actor,
  entry: { date: IsoDate; source: "MANUAL" | "OPENING_BALANCE" | "REVERSAL"; memo: string | null; lines: EntryLine[]; reversesEntryId?: string },
): Promise<{ id: string; number: bigint }> {
  const period = await tx.fiscalPeriod.findFirst({
    where: { companyId: actor.companyId, startDate: { lte: toDbDate(entry.date) }, endDate: { gte: toDbDate(entry.date) } },
    select: { id: true, status: true },
  });
  if (!period) throw new AppError("ledger.noPeriod");
  if (period.status !== "OPEN") throw new AppError("AL003");

  const number = await nextEntryNumber(tx, actor.companyId);
  const created = await tx.journalEntry.create({
    data: {
      companyId: actor.companyId,
      entryNumber: number,
      entryDate: toDbDate(entry.date),
      fiscalPeriodId: period.id,
      sourceType: entry.source,
      reversesEntryId: entry.reversesEntryId ?? null,
      memo: entry.memo,
      createdById: actor.userId,
    },
    select: { id: true },
  });
  await tx.journalLine.createMany({
    data: entry.lines.map((line, index) => ({
      companyId: actor.companyId,
      entryId: created.id,
      lineNo: index + 1,
      accountId: line.accountId,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      description: line.description ?? null,
      contactId: line.contactId ?? null,
      taxId: line.taxId ?? null,
      taxBox: (line.taxBox ?? null) as never,
      entryDate: toDbDate(entry.date),
    })),
  });
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  return { id: created.id, number };
}

/** Posts a manual entry (or the opening balances) after checking it twice: here, and in the database. */
export async function postManualEntry(actor: Actor, input: ManualEntryInput): Promise<{ id: string; number: bigint }> {
  const parsed = manualEntrySchema.safeParse(input);
  if (!parsed.success) throw new AppError("ledger.invalidEntry");
  const { date, kind, memo, lines } = parsed.data;
  const [problem] = checkEntry(lines);
  if (problem) throw new AppError(problemKey(problem));

  return inCompany(actor, async (tx) => {
    await requireRole(tx, "entry.post");
    const ids = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await tx.account.findMany({ where: { companyId: actor.companyId, id: { in: ids } }, select: { id: true, subtype: true, isActive: true } });
    if (accounts.length !== ids.length || accounts.some((account) => !acceptsManualEntries(account))) throw new AppError("ledger.accountNotAllowed");
    return insertEntry(tx, actor, { date, source: kind, memo: memo ?? null, lines });
  });
}

/**
 * Reverses a manual or opening entry with a mirror entry dated `date` (default: today, but never before the
 * entry). Entries of documents, payments and deposits are corrected by voiding them (AL008).
 */
export async function reverseEntry(actor: Actor, entryId: string, options: { date?: IsoDate; memo?: string | null; now?: Date } = {}): Promise<{ id: string; number: bigint }> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "entry.reverse");
    const original = await tx.journalEntry.findFirst({
      where: { companyId: actor.companyId, id: entryId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    if (!original) throw new AppError("ledger.entryNotFound");
    if (original.sourceType !== "MANUAL" && original.sourceType !== "OPENING_BALANCE") throw new AppError("AL008");
    if (await tx.journalEntry.findFirst({ where: { companyId: actor.companyId, reversesEntryId: entryId }, select: { id: true } })) {
      throw new AppError("ledger.alreadyReversed");
    }
    const originalDate = fromDbDate(original.entryDate);
    const today = todayIso(options.now);
    const date = options.date ?? (today >= originalDate ? today : originalDate);
    if (date < originalDate) throw new AppError("AL008");

    const lines: EntryLine[] = original.lines.map((line) => ({
      accountId: line.accountId,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      description: line.description,
      contactId: line.contactId,
      taxId: line.taxId,
      taxBox: line.taxBox,
    }));
    return insertEntry(tx, actor, { date, source: "REVERSAL", memo: options.memo ?? null, lines: reversalLines(lines), reversesEntryId: entryId });
  });
}

type EntryRow = {
  id: string;
  entryNumber: bigint;
  entryDate: Date;
  sourceType: JournalSourceKind;
  memo: string | null;
  reversesEntryId: string | null;
  createdById: string;
  createdAt: Date;
  reversedBy: { id: string } | null;
  lines: { id: string; lineNo: number; accountId: string; debitCents: bigint; creditCents: bigint; description: string | null; account: { code: string; nameFr: string; nameEn: string } }[];
};

function toEntryDto(row: EntryRow, format: { prefix: string; padding: number }): EntryDto {
  return {
    id: row.id,
    number: row.entryNumber,
    numberLabel: formatNumber(format.prefix, format.padding, row.entryNumber),
    date: fromDbDate(row.entryDate),
    source: row.sourceType,
    memo: row.memo,
    reversesEntryId: row.reversesEntryId,
    reversedByEntryId: row.reversedBy?.id ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt,
    totalCents: row.lines.reduce((sum, line) => sum + line.debitCents, 0n),
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountNameFr: line.account.nameFr,
      accountNameEn: line.account.nameEn,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      description: line.description,
    })),
  };
}

const ENTRY_INCLUDE = {
  reversedBy: { select: { id: true } },
  lines: { orderBy: { lineNo: "asc" as const }, include: { account: { select: { code: true, nameFr: true, nameEn: true } } } },
} as const;

export const ENTRIES_PER_PAGE = 25;

export async function listEntries(
  actor: Actor,
  filter: { from?: IsoDate; to?: IsoDate; accountId?: string; page?: number } = {},
): Promise<{ entries: EntryDto[]; total: number; page: number; pageCount: number }> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const where = {
      companyId: actor.companyId,
      ...(filter.from || filter.to ? { entryDate: { ...(filter.from ? { gte: toDbDate(filter.from) } : {}), ...(filter.to ? { lte: toDbDate(filter.to) } : {}) } } : {}),
      ...(filter.accountId ? { lines: { some: { companyId: actor.companyId, accountId: filter.accountId } } } : {}),
    };
    const total = await tx.journalEntry.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / ENTRIES_PER_PAGE));
    const page = Math.min(Math.max(1, filter.page ?? 1), pageCount);
    const rows = await tx.journalEntry.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: [{ entryDate: "desc" }, { entryNumber: "desc" }],
      skip: (page - 1) * ENTRIES_PER_PAGE,
      take: ENTRIES_PER_PAGE,
    });
    const format = await numberFormat(tx, actor.companyId);
    return { entries: rows.map((row) => toEntryDto(row as EntryRow, format)), total, page, pageCount };
  });
}

export async function getEntry(actor: Actor, entryId: string): Promise<EntryDto | null> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const row = await tx.journalEntry.findFirst({ where: { companyId: actor.companyId, id: entryId }, include: ENTRY_INCLUDE });
    if (!row) return null;
    return toEntryDto(row as EntryRow, await numberFormat(tx, actor.companyId));
  });
}
