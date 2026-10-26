import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFiscalYear, postManualEntry } from "@/modules/ledger";
import { getBalanceSheet, getIncomeStatement } from "@/modules/reports";
import { AppError } from "@/platform/errors";
import type { CompanyContext } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor: CompanyContext = { userId: W.userOwnerA, companyId: W.companyA };
const accountant: CompanyContext = { ...actor, userId: W.userAccountant };
const reader: CompanyContext = { ...actor, userId: W.userReader };
const otherOwner: CompanyContext = { userId: W.userOwnerB, companyId: W.companyB };
const intruder: CompanyContext = { userId: W.userOwnerB, companyId: W.companyA };

let db: pg.Client;
const extra: Record<string, string> = {};
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence (company_id, key, next_value, prefix, padding) VALUES ($1, 'JOURNAL_ENTRY', 1, 'J-', 5), ($2, 'JOURNAL_ENTRY', 1, 'J-', 5)", [W.companyA, W.companyB]);
  const add = async (company: string, code: string, nameFr: string, nameEn: string, type: string, subtype: string) => {
    const id = randomUUID();
    await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, updated_at) VALUES ($1, $2, $3, $4, $5, $6::account_type, $7::account_subtype, now())", [id, company, code, nameFr, nameEn, type, subtype]);
    return id;
  };
  extra.cogs = await add(W.companyA, "5100", "Coût des marchandises", "Cost of goods", "EXPENSE", "COST_OF_SALES");
  extra.fixed = await add(W.companyA, "1500", "Équipement", "Equipment", "ASSET", "FIXED_ASSET");
  extra.loan = await add(W.companyA, "2500", "Prêt", "Loan", "LIABILITY", "LONG_TERM_LIABILITY");
  extra.otherRevenue = await add(W.companyA, "4900", "Intérêts reçus", "Interest received", "REVENUE", "OTHER_REVENUE");
  extra.otherExpense = await add(W.companyA, "7000", "Intérêts payés", "Interest paid", "EXPENSE", "OTHER_EXPENSE");
  extra.salesB = await add(W.companyB, "4000", "Ventes B", "Sales B", "REVENUE", "OPERATING_REVENUE");
});
afterAll(async () => { await db?.end(); });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}

/** A balanced two-line entry: `cents` debited to the first account, credited to the second. */
const post = (who: CompanyContext, date: string, debit: string, credit: string, cents: bigint) =>
  postManualEntry(who, { date, kind: "MANUAL", memo: "Essai", lines: [{ accountId: debit, debitCents: cents, creditCents: 0n }, { accountId: credit, debitCents: 0n, creditCents: cents }] });

beforeAll(async () => {
  // 2026: capital, a loan, equipment, sales and expenses
  await post(actor, "2026-01-05", W.bank, W.capital, 5_000_000n); // 50 000,00 of capital
  await post(actor, "2026-01-06", W.bank, extra.loan ?? "", 1_000_000n); // a loan
  await post(actor, "2026-01-07", extra.fixed ?? "", W.bank, 600_000n); // equipment
  await post(actor, "2026-03-10", W.bank, W.sales, 100_000n); // sale
  await post(actor, "2026-03-31", W.bank, W.sales, 20_000n); // sale on the last day
  await post(actor, "2026-04-01", W.bank, W.sales, 50_000n); // sale the day after
  await post(actor, "2026-03-15", W.expenses, W.bank, 30_000n); // operating expense
  await post(actor, "2026-03-20", extra.cogs ?? "", W.bank, 20_000n); // cost of goods
  await post(actor, "2026-03-25", W.bank, extra.otherRevenue ?? "", 500n); // interest received
  await post(actor, "2026-03-26", extra.otherExpense ?? "", W.bank, 200n); // interest paid
  await post(otherOwner, "2026-03-12", W.bankB, extra.salesB ?? "", 999_999n); // another company's sale
});

describe("the income statement", () => {
  it("adds up the revenue and the expenses of the period, both days included, and leaves out the rest of the ledger", async () => {
    const { statement } = await getIncomeStatement(actor, { from: "2026-03-01", to: "2026-03-31" });
    expect(statement.operatingRevenue.totalCents).toBe(120_000n); // the sale of the 10th and that of the 31st, not that of April 1st
    expect(statement.operatingRevenue.lines).toEqual([expect.objectContaining({ code: "4000", cents: 120_000n })]);
    expect(statement.costOfSales.totalCents).toBe(20_000n);
    expect(statement.grossProfitCents).toBe(100_000n);
    expect(statement.operatingExpenses.totalCents).toBe(30_000n);
    expect(statement.operatingIncomeCents).toBe(70_000n);
    expect(statement.otherRevenue.totalCents).toBe(500n);
    expect(statement.otherExpenses.totalCents).toBe(200n);
    expect(statement.netIncomeCents).toBe(70_300n);
    // capital, loan and equipment are not part of it
    const all = await getIncomeStatement(actor, { from: "2026-01-01", to: "2026-12-31" });
    expect(all.statement.operatingRevenue.totalCents).toBe(170_000n);
    expect(all.statement.netIncomeCents).toBe(120_300n);
  });

  it("reports a single day, and a period with nothing in it", async () => {
    expect((await getIncomeStatement(actor, { from: "2026-03-31", to: "2026-03-31" })).statement.operatingRevenue.totalCents).toBe(20_000n);
    expect((await getIncomeStatement(actor, { from: "2026-02-01", to: "2026-02-28" })).statement.netIncomeCents).toBe(0n);
  });

  it("is read by the members who read the ledger, and by nobody else", async () => {
    expect((await getIncomeStatement(reader, { from: "2026-03-01", to: "2026-03-31" })).statement.netIncomeCents).toBe(70_300n);
    expect((await getIncomeStatement(accountant, { from: "2026-03-01", to: "2026-03-31" })).statement.netIncomeCents).toBe(70_300n);
    expect(await refusal(getIncomeStatement(intruder, { from: "2026-03-01", to: "2026-03-31" }))).toBe("forbidden");
    // the other company has its own
    expect((await getIncomeStatement(otherOwner, { from: "2026-03-01", to: "2026-03-31" })).statement.operatingRevenue.totalCents).toBe(999_999n);
  });

  it("refuses days that do not exist and a period that ends before it begins", async () => {
    for (const period of [{ from: "2026-02-30", to: "2026-03-31" }, { from: "2026-03-01", to: "pas une date" }, { from: "2026-03-31", to: "2026-03-01" }, { from: "", to: "" }]) {
      expect(await refusal(getIncomeStatement(actor, period))).toBe("reports.period");
    }
  });
});

describe("the balance sheet", () => {
  it("groups the accounts and balances, with the earnings of the year in equity", async () => {
    const report = await getBalanceSheet(actor, "2026-03-31");
    const { sheet } = report;
    expect(report.fiscalYearStart).toBe("2026-01-01");
    // the bank: 50 000 + 10 000 − 6 000 + 1 000 + 200 − 300 − 200 + 5 − 2 = 54 703,00; the April sale is not in
    expect(sheet.currentAssets.lines).toEqual([expect.objectContaining({ code: "1000", cents: 5_470_300n })]);
    expect(sheet.fixedAssets.lines).toEqual([expect.objectContaining({ code: "1500", cents: 600_000n })]);
    expect(sheet.totalAssetsCents).toBe(6_070_300n);
    expect(sheet.longTermLiabilities.totalCents).toBe(1_000_000n);
    expect(sheet.equity.lines).toEqual([expect.objectContaining({ code: "3000", cents: 5_000_000n })]);
    expect(sheet.priorEarningsCents).toBe(0n);
    expect(sheet.currentEarningsCents).toBe(70_300n);
    expect(sheet.totalEquityCents).toBe(5_070_300n);
    expect(sheet.balanced).toBe(true);
    expect(sheet.totalLiabilitiesAndEquityCents).toBe(sheet.totalAssetsCents);
  });

  it("shows the earnings of the earlier fiscal years apart from those of the current one", async () => {
    await createFiscalYear(actor, { containing: "2027-02-01" });
    await post(actor, "2027-02-10", W.bank, W.sales, 40_000n);
    await post(actor, "2027-01-01", W.bank, W.sales, 10_000n); // the first day of the year is the year's
    const { sheet, fiscalYearStart } = await getBalanceSheet(actor, "2027-03-31");
    expect(fiscalYearStart).toBe("2027-01-01");
    expect(sheet.priorEarningsCents).toBe(120_300n); // all of 2026, and not a cent of 2027
    expect(sheet.currentEarningsCents).toBe(50_000n);
    expect(sheet.balanced).toBe(true);
  });

  it("puts everything in one line when the day is in no fiscal year", async () => {
    const { sheet, fiscalYearStart } = await getBalanceSheet(actor, "2031-01-01");
    expect(fiscalYearStart).toBeNull();
    expect(sheet.priorEarningsCents).toBe(0n);
    expect(sheet.currentEarningsCents).toBe(170_300n);
    expect(sheet.balanced).toBe(true);
  });

  it("is empty before the first entry, and refused for a day that does not exist or to those who do not belong to the company", async () => {
    const empty = await getBalanceSheet(actor, "2025-06-30");
    expect(empty.sheet).toMatchObject({ totalAssetsCents: 0n, totalEquityCents: 0n, balanced: true });
    expect(await refusal(getBalanceSheet(actor, "2026-02-30"))).toBe("reports.period");
    expect(await refusal(getBalanceSheet(actor, ""))).toBe("reports.period");
    expect(await refusal(getBalanceSheet(intruder, "2026-03-31"))).toBe("forbidden");
    expect((await getBalanceSheet(reader, "2026-03-31")).sheet.balanced).toBe(true);
    expect((await getBalanceSheet(otherOwner, "2026-03-31")).sheet.totalAssetsCents).toBe(999_999n);
  });
});
