import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { buildBalanceSheet, buildIncomeStatement, type AccountTotals, type BalanceSheet, type IncomeStatement } from "../domain/statements";

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const day = (value: string): Date => new Date(`${value}T00:00:00Z`);

export type IncomeStatementReport = { from: string; to: string; statement: IncomeStatement };
export type BalanceSheetReport = {
  asOf: string;
  /** The first day of the fiscal year the day falls in, when there is one: what came before it is the earnings of earlier years. */
  fiscalYearStart: string | null;
  sheet: BalanceSheet;
};

type Row = { account_id: string; debit: bigint; credit: bigint };

/** Debit and credit totals per account over dates, with the accounts' names and kinds. `from` null is from the beginning. */
async function totals(tx: Tx, companyId: string, from: string | null, to: string, types?: readonly string[]): Promise<AccountTotals[]> {
  const rows = await tx.$queryRaw<Row[]>`
    SELECT l.account_id, sum(l.debit_cents)::bigint AS debit, sum(l.credit_cents)::bigint AS credit
      FROM journal_line l
      JOIN account a ON a.company_id = l.company_id AND a.id = l.account_id
     WHERE l.company_id = ${companyId}::uuid
       AND (${from}::date IS NULL OR l.entry_date >= ${from}::date) AND l.entry_date <= ${to}::date
       AND (${types ?? null}::text[] IS NULL OR a.type::text = ANY(${types ?? []}::text[]))
     GROUP BY l.account_id`;
  if (rows.length === 0) return [];
  const accounts = await tx.account.findMany({
    where: { companyId, id: { in: rows.map((row) => row.account_id) } },
    select: { id: true, code: true, nameFr: true, nameEn: true, type: true, subtype: true },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return rows.flatMap((row) => {
    const account = byId.get(row.account_id);
    return account ? [{ accountId: account.id, code: account.code, nameFr: account.nameFr, nameEn: account.nameEn, type: account.type, subtype: account.subtype, debitCents: row.debit, creditCents: row.credit }] : [];
  });
}

const validDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(day(value)) === value;

/**
 * The income statement of a period (both days included), from the revenue and expense lines of the ledger dated in
 * it. Every member who reads the ledger reads it. Accounts that net to zero are left out.
 */
export async function getIncomeStatement(actor: CompanyContext, period: { from: string; to: string }): Promise<IncomeStatementReport> {
  if (!validDay(period.from) || !validDay(period.to) || period.from > period.to) throw new AppError("reports.period");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const rows = await totals(tx, actor.companyId, period.from, period.to, ["REVENUE", "EXPENSE"]);
    return { from: period.from, to: period.to, statement: buildIncomeStatement(rows) };
  });
}

/**
 * The balance sheet at a day, from every ledger line up to it. The earnings of the fiscal years before the one the
 * day falls in are shown apart from those of the current one. Every member who reads the ledger reads it.
 */
export async function getBalanceSheet(actor: CompanyContext, asOf: string): Promise<BalanceSheetReport> {
  if (!validDay(asOf)) throw new AppError("reports.period");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const rows = await totals(tx, actor.companyId, null, asOf);
    const year = await tx.fiscalYear.findFirst({ where: { companyId: actor.companyId, startDate: { lte: day(asOf) }, endDate: { gte: day(asOf) } }, select: { startDate: true } });
    const fiscalYearStart = year ? iso(year.startDate) : null;
    let priorEarningsCents = 0n;
    if (fiscalYearStart !== null) {
      const before = new Date(day(fiscalYearStart).getTime() - 86_400_000);
      const earlier = await totals(tx, actor.companyId, null, iso(before), ["REVENUE", "EXPENSE"]);
      priorEarningsCents = earlier.reduce((sum, row) => sum + row.creditCents - row.debitCents, 0n);
    }
    return { asOf, fiscalYearStart, sheet: buildBalanceSheet(rows, { priorEarningsCents }) };
  });
}
