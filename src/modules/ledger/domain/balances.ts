import { isDebitNormal, type AccountType } from "./accounts";

export type PostedLine = { accountId: string; debitCents: bigint; creditCents: bigint };
export type AccountInfo = { id: string; type: AccountType };

export type TrialBalanceRow = { accountId: string; debitCents: bigint; creditCents: bigint };

/** Debit and credit totals per account, in first-seen order. */
export function trialBalance(lines: readonly PostedLine[]): TrialBalanceRow[] {
  const rows = new Map<string, TrialBalanceRow>();
  for (const line of lines) {
    const row = rows.get(line.accountId) ?? { accountId: line.accountId, debitCents: 0n, creditCents: 0n };
    row.debitCents += line.debitCents;
    row.creditCents += line.creditCents;
    rows.set(line.accountId, row);
  }
  return [...rows.values()];
}

/** The trial balance balances when total debits equal total credits (property P1). */
export function isBalanced(rows: readonly TrialBalanceRow[]): boolean {
  return rows.reduce((sum, row) => sum + row.debitCents - row.creditCents, 0n) === 0n;
}

/** Balance in the account's natural direction: positive when it holds what its type normally holds. */
export function naturalBalance(type: AccountType, row: Pick<TrialBalanceRow, "debitCents" | "creditCents">): bigint {
  return isDebitNormal(type) ? row.debitCents - row.creditCents : row.creditCents - row.debitCents;
}

/** Totals by type, in natural direction, for the accounting equation (property P8). */
export function totalsByType(rows: readonly TrialBalanceRow[], accounts: readonly AccountInfo[]): Record<AccountType, bigint> {
  const typeOf = new Map(accounts.map((account) => [account.id, account.type]));
  const totals: Record<AccountType, bigint> = { ASSET: 0n, LIABILITY: 0n, EQUITY: 0n, REVENUE: 0n, EXPENSE: 0n };
  for (const row of rows) {
    const type = typeOf.get(row.accountId);
    if (!type) throw new RangeError(`unknown account ${row.accountId}`);
    totals[type] += naturalBalance(type, row);
  }
  return totals;
}

/** Assets = liabilities + equity + (revenue - expenses), at any date. */
export function accountingEquationHolds(totals: Record<AccountType, bigint>): boolean {
  return totals.ASSET === totals.LIABILITY + totals.EQUITY + (totals.REVENUE - totals.EXPENSE);
}
