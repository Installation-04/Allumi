import { z } from "zod";
import { MAX_LINE_CENTS } from "@/modules/ledger/client";

export const budgetInput = z.object({
  name: z.string().trim().min(1).max(120).refine(s => !/[\u0000-\u001f\u007f-\u009f]/u.test(s)),
  fiscalYearId: z.uuid(),
});
export const targetInput = z.object({
  accountId: z.uuid(),
  amountCents: z.bigint().min(0n).max(MAX_LINE_CENTS),
  revision: z.number().int().positive().max(2147483646),
});
export const MAX_BUDGET_ACCOUNTS = 1000;
export type BudgetAccount = {
  accountId: string; code: string; nameFr: string; nameEn: string;
  type: "REVENUE" | "EXPENSE"; isActive: boolean;
  targetCents: bigint | null; actualCents: bigint; hasActivity: boolean;
};
export type BudgetRow = BudgetAccount & { differenceCents: bigint | null };
export function compareBudget(accounts: readonly BudgetAccount[]) {
  const rows: BudgetRow[] = accounts.map(a => ({ ...a, differenceCents: a.targetCents === null ? null : a.actualCents - a.targetCents }));
  const totals = (type: BudgetAccount["type"]) => rows.filter(r => r.type === type).reduce((sum, r) => ({
    targetCents: sum.targetCents + (r.targetCents ?? 0n), actualCents: sum.actualCents + r.actualCents,
    unbudgeted: sum.unbudgeted + (r.targetCents === null && r.hasActivity ? 1 : 0),
  }), { targetCents: 0n, actualCents: 0n, unbudgeted: 0 });
  return { rows, revenue: totals("REVENUE"), expenses: totals("EXPENSE") };
}
