import "server-only";
import { requireRole } from "@/modules/companies";
import { isBalanced, totalsByType, accountingEquationHolds, type TrialBalanceRow } from "../domain/balances";
import type { IsoDate } from "../domain/dates";
import type { AccountType } from "../domain/accounts";
import { toDbDate } from "./dates";
import { inCompany, type Actor } from "./support";

export type TrialBalanceLine = {
  accountId: string;
  code: string;
  nameFr: string;
  nameEn: string;
  type: AccountType;
  debitCents: bigint;
  creditCents: bigint;
};

export type TrialBalance = {
  asOf: IsoDate | null;
  lines: TrialBalanceLine[];
  totalDebitCents: bigint;
  totalCreditCents: bigint;
  /** Always true in a sound ledger: the page says so, and a false would be an incident. */
  balanced: boolean;
  equationHolds: boolean;
};

/** Debit and credit totals per account up to a date (all dates if none), read from the ledger. */
export async function getTrialBalance(actor: Actor, options: { asOf?: IsoDate } = {}): Promise<TrialBalance> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const asOf = options.asOf ? toDbDate(options.asOf) : null;
    const sums = await tx.$queryRaw<{ account_id: string; debit: bigint; credit: bigint }[]>`
      SELECT account_id, sum(debit_cents)::bigint AS debit, sum(credit_cents)::bigint AS credit
        FROM journal_line
       WHERE company_id = ${actor.companyId}::uuid AND (${asOf}::date IS NULL OR entry_date <= ${asOf}::date)
       GROUP BY account_id`;
    const accounts = await tx.account.findMany({
      where: { companyId: actor.companyId },
      select: { id: true, code: true, nameFr: true, nameEn: true, type: true },
      orderBy: { code: "asc" },
    });
    const byAccount = new Map(sums.map((row) => [row.account_id, row]));
    const lines = accounts
      .filter((account) => byAccount.has(account.id))
      .map((account) => ({ accountId: account.id, code: account.code, nameFr: account.nameFr, nameEn: account.nameEn, type: account.type, debitCents: byAccount.get(account.id)?.debit ?? 0n, creditCents: byAccount.get(account.id)?.credit ?? 0n }));
    const rows: TrialBalanceRow[] = lines.map(({ accountId, debitCents, creditCents }) => ({ accountId, debitCents, creditCents }));
    return {
      asOf: options.asOf ?? null,
      lines,
      totalDebitCents: lines.reduce((sum, line) => sum + line.debitCents, 0n),
      totalCreditCents: lines.reduce((sum, line) => sum + line.creditCents, 0n),
      balanced: isBalanced(rows),
      equationHolds: accountingEquationHolds(totalsByType(rows, lines.map((line) => ({ id: line.accountId, type: line.type })))),
    };
  });
}
