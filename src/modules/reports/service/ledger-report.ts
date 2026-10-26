import "server-only";
import { requireRole } from "@/modules/companies";
import { formatNumber, isValidIsoDate, naturalBalance, type AccountType } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { runLedger, type LedgerAccountReport, type LedgerLine, type LedgerRow } from "../domain/ledger-report";

export const LEDGER_PAGE_SIZE = 100;
/** The most lines a file of every account can hold: past this the period is too long to export at once. */
export const MAX_EXPORT_LINES = 200_000;

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LedgerAccount = { id: string; code: string; nameFr: string; nameEn: string; type: AccountType };

export type AccountLedger = {
  account: LedgerAccount;
  from: string;
  to: string;
  /** In the direction the account's type normally holds, like every balance of this report. */
  openingCents: bigint;
  closingCents: bigint;
  /** What the period debited and credited, in all. */
  debitCents: bigint;
  creditCents: bigint;
  /** The lines of the page, with the balance after each. */
  rows: LedgerRow[];
  lineCount: number;
  page: number;
  pageCount: number;
};

type LineRow = {
  line_id: string; entry_id: string; entry_number: bigint; entry_date: Date; source_type: string; memo: string | null; description: string | null;
  contact_name: string | null; debit_cents: bigint; credit_cents: bigint; reversed: boolean; account_id?: string;
};

async function numberFormat(tx: Tx, companyId: string): Promise<{ prefix: string; padding: number }> {
  return (await tx.numberSequence.findUnique({ where: { companyId_key: { companyId, key: "JOURNAL_ENTRY" } }, select: { prefix: true, padding: true } })) ?? { prefix: "", padding: 0 };
}

const toLine = (row: LineRow, format: { prefix: string; padding: number }): LedgerLine => ({
  lineId: row.line_id, entryId: row.entry_id, entryNumber: row.entry_number, entryLabel: formatNumber(format.prefix, format.padding, row.entry_number), date: iso(row.entry_date),
  sourceType: row.source_type, memo: row.memo, description: row.description, contactName: row.contact_name, debitCents: row.debit_cents, creditCents: row.credit_cents, reversed: row.reversed,
});

/**
 * The ledger of one account over a period: its balance at the start, each line dated in it in the order the ledger
 * keeps them (date, entry number, line number) with the balance after it, and its balance at the end. Read by the
 * hundred; every figure is exact, and the balances run across pages. Every member who reads the ledger reads it.
 */
export async function getAccountLedger(actor: CompanyContext, input: { accountId: string; from: string; to: string; page?: number }): Promise<AccountLedger> {
  if (!isValidIsoDate(input.from) || !isValidIsoDate(input.to) || input.from > input.to) throw new AppError("reports.period");
  if (!UUID.test(input.accountId)) throw new AppError("reports.account");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: input.accountId }, select: { id: true, code: true, nameFr: true, nameEn: true, type: true } });
    if (!account) throw new AppError("reports.account");
    const [before] = await tx.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT coalesce(sum(debit_cents), 0)::bigint AS debit, coalesce(sum(credit_cents), 0)::bigint AS credit
        FROM journal_line WHERE company_id = ${actor.companyId}::uuid AND account_id = ${account.id}::uuid AND entry_date < ${input.from}::date`;
    const [within] = await tx.$queryRaw<{ n: number; debit: bigint; credit: bigint }[]>`
      SELECT count(*)::int AS n, coalesce(sum(debit_cents), 0)::bigint AS debit, coalesce(sum(credit_cents), 0)::bigint AS credit
        FROM journal_line WHERE company_id = ${actor.companyId}::uuid AND account_id = ${account.id}::uuid AND entry_date BETWEEN ${input.from}::date AND ${input.to}::date`;
    const lineCount = within?.n ?? 0;
    const pageCount = Math.max(1, Math.ceil(lineCount / LEDGER_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.trunc(input.page ?? 1) || 1), pageCount);
    const skipped = (page - 1) * LEDGER_PAGE_SIZE;
    const openingCents = naturalBalance(account.type, { debitCents: before?.debit ?? 0n, creditCents: before?.credit ?? 0n });
    // What the lines before this page add: the page's balances start from there.
    const [skippedSums] = await tx.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT coalesce(sum(s.debit_cents), 0)::bigint AS debit, coalesce(sum(s.credit_cents), 0)::bigint AS credit
        FROM (SELECT l.debit_cents, l.credit_cents FROM journal_line l JOIN journal_entry e ON e.company_id = l.company_id AND e.id = l.entry_id
               WHERE l.company_id = ${actor.companyId}::uuid AND l.account_id = ${account.id}::uuid AND l.entry_date BETWEEN ${input.from}::date AND ${input.to}::date
               ORDER BY l.entry_date, e.entry_number, l.line_no LIMIT ${skipped}) s`;
    const pageOpening = openingCents + naturalBalance(account.type, { debitCents: skippedSums?.debit ?? 0n, creditCents: skippedSums?.credit ?? 0n });
    const rows = await tx.$queryRaw<LineRow[]>`
      SELECT l.id AS line_id, l.entry_id, e.entry_number, e.entry_date, e.source_type::text AS source_type, e.memo, l.description, c.display_name AS contact_name,
             l.debit_cents, l.credit_cents,
             (e.reverses_entry_id IS NOT NULL OR EXISTS (SELECT 1 FROM journal_entry r WHERE r.company_id = e.company_id AND r.reverses_entry_id = e.id)) AS reversed
        FROM journal_line l
        JOIN journal_entry e ON e.company_id = l.company_id AND e.id = l.entry_id
        LEFT JOIN contact c ON c.company_id = l.company_id AND c.id = l.contact_id
       WHERE l.company_id = ${actor.companyId}::uuid AND l.account_id = ${account.id}::uuid AND l.entry_date BETWEEN ${input.from}::date AND ${input.to}::date
       ORDER BY l.entry_date, e.entry_number, l.line_no
       LIMIT ${LEDGER_PAGE_SIZE} OFFSET ${skipped}`;
    const format = await numberFormat(tx, actor.companyId);
    const run = runLedger(account.type, pageOpening, rows.map((row) => toLine(row, format)));
    const closingCents = openingCents + naturalBalance(account.type, { debitCents: within?.debit ?? 0n, creditCents: within?.credit ?? 0n });
    return {
      account, from: input.from, to: input.to, openingCents, closingCents, debitCents: within?.debit ?? 0n, creditCents: within?.credit ?? 0n,
      rows: run.rows, lineCount, page, pageCount,
    };
  });
}

export type ExportedLedger = LedgerAccountReport & { account: LedgerAccount };

/**
 * The ledger of one account, or of every account that moved or holds a balance in the period, whole, for a file: each
 * with its opening balance, its lines with the running balance, and its closing balance. Refused past 200 000 lines.
 */
export async function getLedgerExport(actor: CompanyContext, input: { accountId: string | null; from: string; to: string }, options: { maxLines?: number } = {}): Promise<ExportedLedger[]> {
  if (!isValidIsoDate(input.from) || !isValidIsoDate(input.to) || input.from > input.to) throw new AppError("reports.period");
  if (input.accountId !== null && !UUID.test(input.accountId)) throw new AppError("reports.account");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const accounts = await tx.account.findMany({
      where: { companyId: actor.companyId, ...(input.accountId ? { id: input.accountId } : {}) },
      select: { id: true, code: true, nameFr: true, nameEn: true, type: true }, orderBy: { code: "asc" },
    });
    if (input.accountId !== null && accounts.length === 0) throw new AppError("reports.account");
    const ids = accounts.map((account) => account.id);
    const [counted] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM journal_line WHERE company_id = ${actor.companyId}::uuid AND account_id = ANY(${ids}::uuid[]) AND entry_date BETWEEN ${input.from}::date AND ${input.to}::date`;
    if ((counted?.n ?? 0) > (options.maxLines ?? MAX_EXPORT_LINES)) throw new AppError("reports.tooManyLines");
    const openings = await tx.$queryRaw<{ account_id: string; debit: bigint; credit: bigint }[]>`
      SELECT account_id, sum(debit_cents)::bigint AS debit, sum(credit_cents)::bigint AS credit
        FROM journal_line WHERE company_id = ${actor.companyId}::uuid AND account_id = ANY(${ids}::uuid[]) AND entry_date < ${input.from}::date GROUP BY account_id`;
    const lines = await tx.$queryRaw<(LineRow & { account_id: string })[]>`
      SELECT l.account_id, l.id AS line_id, l.entry_id, e.entry_number, e.entry_date, e.source_type::text AS source_type, e.memo, l.description, c.display_name AS contact_name,
             l.debit_cents, l.credit_cents,
             (e.reverses_entry_id IS NOT NULL OR EXISTS (SELECT 1 FROM journal_entry r WHERE r.company_id = e.company_id AND r.reverses_entry_id = e.id)) AS reversed
        FROM journal_line l
        JOIN journal_entry e ON e.company_id = l.company_id AND e.id = l.entry_id
        LEFT JOIN contact c ON c.company_id = l.company_id AND c.id = l.contact_id
       WHERE l.company_id = ${actor.companyId}::uuid AND l.account_id = ANY(${ids}::uuid[]) AND l.entry_date BETWEEN ${input.from}::date AND ${input.to}::date
       ORDER BY l.account_id, l.entry_date, e.entry_number, l.line_no`;
    const format = await numberFormat(tx, actor.companyId);
    const opening = new Map(openings.map((row) => [row.account_id, row]));
    const byAccount = new Map<string, LedgerLine[]>();
    for (const row of lines) {
      const own = byAccount.get(row.account_id) ?? [];
      own.push(toLine(row, format));
      byAccount.set(row.account_id, own);
    }
    const result: ExportedLedger[] = [];
    for (const account of accounts) {
      const before = opening.get(account.id);
      const openingCents = naturalBalance(account.type, { debitCents: before?.debit ?? 0n, creditCents: before?.credit ?? 0n });
      const own = byAccount.get(account.id) ?? [];
      if (own.length === 0 && openingCents === 0n && input.accountId === null) continue;
      const run = runLedger(account.type, openingCents, own);
      result.push({ account, openingCents, closingCents: run.closingCents, rows: run.rows });
    }
    return result;
  });
}
