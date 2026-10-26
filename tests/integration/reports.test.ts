import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFiscalYear, postManualEntry, reverseEntry } from "@/modules/ledger";
import { getAccountLedger, getBalanceSheet, getIncomeStatement, getLedgerExport, LEDGER_PAGE_SIZE } from "@/modules/reports";
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
  extra.pager = await add(W.companyA, "1800", "Compte long", "Long account", "ASSET", "CURRENT_ASSET");
  extra.idle = await add(W.companyA, "1900", "Compte inactif", "Idle account", "ASSET", "CURRENT_ASSET");
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
    for (const period of [{ from: "2026-02-30", to: "2026-03-31" }, { from: "2026-13-01", to: "2026-12-31" }, { from: "2026-01-00", to: "2026-01-31" }, { from: "2026-01-01", to: "2026-01-32" }, { from: "2026-03-01", to: "pas une date" }, { from: "2026-03-31", to: "2026-03-01" }, { from: "", to: "" }]) {
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
    for (const impossible of ["2026-13-01", "2026-00-10", "2026-01-32"]) expect(await refusal(getBalanceSheet(actor, impossible)), impossible).toBe("reports.period");
    expect(await refusal(getBalanceSheet(actor, ""))).toBe("reports.period");
    expect(await refusal(getBalanceSheet(intruder, "2026-03-31"))).toBe("forbidden");
    expect((await getBalanceSheet(reader, "2026-03-31")).sheet.balanced).toBe(true);
    expect((await getBalanceSheet(otherOwner, "2026-03-31")).sheet.totalAssetsCents).toBe(999_999n);
  });
});

describe("the ledger of an account", () => {
  const march = { from: "2026-03-01", to: "2026-03-31" };

  it("shows the balance at the start, each line in date order with the balance after it, and the balance at the end", async () => {
    const ledger = await getAccountLedger(actor, { accountId: W.bank, ...march });
    expect(ledger.account).toMatchObject({ code: "1000", type: "ASSET" });
    expect(ledger.openingCents).toBe(5_400_000n); // the capital, the loan and the equipment of January
    // by date first: the sale of the 31st was posted before the expense of the 15th, and comes last
    expect(ledger.rows.map((row) => [row.date, row.debitCents, row.creditCents, row.balanceCents])).toEqual([
      ["2026-03-10", 100_000n, 0n, 5_500_000n],
      ["2026-03-15", 0n, 30_000n, 5_470_000n],
      ["2026-03-20", 0n, 20_000n, 5_450_000n],
      ["2026-03-25", 500n, 0n, 5_450_500n],
      ["2026-03-26", 0n, 200n, 5_450_300n],
      ["2026-03-31", 20_000n, 0n, 5_470_300n],
    ]);
    expect(ledger).toMatchObject({ closingCents: 5_470_300n, debitCents: 120_500n, creditCents: 50_200n, lineCount: 6, page: 1, pageCount: 1 });
    expect(ledger.rows[0]).toMatchObject({ entryLabel: expect.stringMatching(/^J-\d{5}$/), memo: "Essai", sourceType: "MANUAL", reversed: false, contactName: null });
    // the closing balance is the balance sheet's bank line
    expect((await getBalanceSheet(actor, "2026-03-31")).sheet.currentAssets.lines[0]?.cents).toBe(ledger.closingCents);
  });

  it("reads an account in the direction its type holds: a revenue account grows with credits", async () => {
    const ledger = await getAccountLedger(actor, { accountId: W.sales, from: "2026-01-01", to: "2026-12-31" });
    expect(ledger.openingCents).toBe(0n);
    expect(ledger.rows.map((row) => row.balanceCents)).toEqual([100_000n, 120_000n, 170_000n]);
    expect(ledger.closingCents).toBe(170_000n);
    const expenses = await getAccountLedger(actor, { accountId: W.expenses, ...march });
    expect(expenses.rows.map((row) => row.balanceCents)).toEqual([30_000n]); // an expense grows with debits
  });

  it("orders lines of one day by the entry's number, flags what was reversed and a reversal, and starts from the balance before the first line", async () => {
    const first = await post(actor, "2026-05-05", W.bank, W.sales, 1_000n);
    const second = await post(actor, "2026-05-05", W.expenses, W.bank, 400n);
    await reverseEntry(actor, first.id, { date: "2026-05-06" });
    const ledger = await getAccountLedger(actor, { accountId: W.bank, from: "2026-05-05", to: "2026-05-06" });
    expect(ledger.rows.map((row) => [row.entryId, row.date, row.reversed])).toEqual([[first.id, "2026-05-05", true], [second.id, "2026-05-05", false], [expect.any(String), "2026-05-06", true]]);
    expect(ledger.rows.map((row) => row.balanceCents)).toEqual([ledger.openingCents + 1_000n, ledger.openingCents + 600n, ledger.openingCents - 400n]);
    expect(ledger.openingCents).toBe(5_470_300n + 50_000n); // what is in the bank at the end of March plus the April sale
  });

  it("puts the lines of one day in the order of the entries' numbers, whatever order they were stored in", async () => {
    // two entries stored in the opposite order to their numbers, each with its line number 1 on the bank
    await db.query("BEGIN");
    try {
      for (const [number, cents] of [[800_001, 111], [800_000, 222]] as const) {
        const id = randomUUID();
        await db.query(
          "INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, created_by_id) SELECT $1, $2, $3, '2026-07-07', id, 'MANUAL', $4 FROM fiscal_period WHERE company_id = $2 AND start_date = '2026-07-01'",
          [id, W.companyA, number, W.userOwnerA],
        );
        await db.query("INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date) VALUES (gen_random_uuid(), $1, $2, 1, $3, $5, 0, '2026-07-07'), (gen_random_uuid(), $1, $2, 2, $4, 0, $5, '2026-07-07')", [W.companyA, id, W.bank, W.sales, cents]);
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    const ledger = await getAccountLedger(actor, { accountId: W.bank, from: "2026-07-07", to: "2026-07-07" });
    expect(ledger.rows.map((row) => [row.entryNumber, row.debitCents])).toEqual([[800_000n, 222n], [800_001n, 111n]]);
    expect(ledger.rows.map((row) => row.balanceCents)).toEqual([ledger.openingCents + 222n, ledger.openingCents + 333n]);
  });

  it("keeps the balance running across pages, with exact figures", async () => {
    // 230 lines of different days and different amounts, so the order of the lines before a page matters to its balances
    const expected: { date: string; n: number; cents: bigint }[] = [];
    for (let i = 0; i < 230; i += 1) {
      const date = `2026-06-${String(1 + ((i * 7) % 28)).padStart(2, "0")}`;
      const cents = BigInt(100 + (i % 13) * 17);
      await post(actor, date, extra.pager ?? "", W.sales, cents);
      expected.push({ date, n: i, cents });
    }
    expected.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.n - b.n));
    let running = 0n;
    const balances = expected.map((line) => (running += line.cents));
    const range = { accountId: extra.pager ?? "", from: "2026-06-01", to: "2026-06-30" };
    const [one, two, three] = [await getAccountLedger(actor, { ...range, page: 1 }), await getAccountLedger(actor, { ...range, page: 2 }), await getAccountLedger(actor, { ...range, page: 3 })];
    expect([one.rows.length, two.rows.length, three.rows.length]).toEqual([LEDGER_PAGE_SIZE, LEDGER_PAGE_SIZE, 30]);
    expect([one.lineCount, one.pageCount, three.page]).toEqual([230, 3, 3]);
    expect([...one.rows, ...two.rows, ...three.rows].map((row) => row.balanceCents)).toEqual(balances);
    expect([...one.rows, ...two.rows, ...three.rows].map((row) => row.debitCents)).toEqual(expected.map((line) => line.cents));
    expect([one.closingCents, two.closingCents, three.closingCents]).toEqual([running, running, running]);
    // no line twice, none missing
    expect(new Set([...one.rows, ...two.rows, ...three.rows].map((row) => row.lineId)).size).toBe(230);
    // a page out of range is the last, a page that is not a number the first
    expect((await getAccountLedger(actor, { ...range, page: 99 })).page).toBe(3);
    expect((await getAccountLedger(actor, { ...range, page: 0 })).page).toBe(1);
    expect((await getAccountLedger(actor, { ...range, page: Number.NaN })).page).toBe(1);
  });

  it("is empty for a period with nothing in it, but still has its balance", async () => {
    const ledger = await getAccountLedger(actor, { accountId: W.bank, from: "2026-02-01", to: "2026-02-28" });
    expect(ledger).toMatchObject({ rows: [], lineCount: 0, pageCount: 1, openingCents: 5_400_000n, closingCents: 5_400_000n, debitCents: 0n, creditCents: 0n });
    const none = await getAccountLedger(actor, { accountId: extra.idle ?? "", ...march });
    expect(none).toMatchObject({ rows: [], openingCents: 0n, closingCents: 0n });
  });

  it("is read by the members who read the ledger, never across companies, and refuses a bad account or period", async () => {
    expect((await getAccountLedger(reader, { accountId: W.bank, ...march })).closingCents).toBe(5_470_300n);
    expect(await refusal(getAccountLedger(intruder, { accountId: W.bank, ...march }))).toBe("forbidden");
    expect(await refusal(getAccountLedger(otherOwner, { accountId: W.bank, ...march }))).toBe("reports.account"); // another company's account
    expect((await getAccountLedger(otherOwner, { accountId: W.bankB, ...march })).closingCents).toBe(999_999n);
    expect(await refusal(getAccountLedger(actor, { accountId: randomUUID(), ...march }))).toBe("reports.account");
    expect(await refusal(getAccountLedger(actor, { accountId: "pas-un-id", ...march }))).toBe("reports.account");
    for (const period of [{ from: "2026-02-30", to: "2026-03-31" }, { from: "2026-13-01", to: "2026-12-31" }, { from: "2026-01-01", to: "2026-00-10" }, { from: "2026-03-31", to: "2026-03-01" }, { from: "", to: "" }]) expect(await refusal(getAccountLedger(actor, { accountId: W.bank, ...period }))).toBe("reports.period");
  });

  it("exports one account whole, or every account that moved or holds a balance, by code", async () => {
    const one = await getLedgerExport(actor, { accountId: W.bank, ...march });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ openingCents: 5_400_000n, closingCents: 5_470_300n });
    expect(one[0]?.rows).toHaveLength(6);
    const all = await getLedgerExport(actor, { accountId: null, ...march });
    const codes = all.map((ledger) => ledger.account.code);
    expect(codes).toEqual([...codes].sort());
    // the bank moved; the capital holds a balance from January; the pager account and the idle one have nothing
    expect(codes).toEqual(expect.arrayContaining(["1000", "1500", "2500", "3000", "4000", "4900", "5000", "5100", "7000"]));
    expect(codes).not.toContain("1800");
    expect(codes).not.toContain("1900");
    expect(all.find((ledger) => ledger.account.code === "3000")).toMatchObject({ openingCents: 5_000_000n, closingCents: 5_000_000n, rows: [] });
    // the one account asked for is given even with nothing in it
    expect((await getLedgerExport(actor, { accountId: extra.idle ?? "", ...march })).map((ledger) => ledger.account.code)).toEqual(["1900"]);
    // a line dated the first day of the period belongs to the period, not to its opening balance
    const fromTenth = await getLedgerExport(actor, { accountId: W.bank, from: "2026-03-10", to: "2026-03-31" });
    expect(fromTenth[0]?.openingCents).toBe(5_400_000n);
    expect(fromTenth[0]?.rows[0]).toMatchObject({ date: "2026-03-10", balanceCents: 5_500_000n });
    // each account's closing balance is the last of its lines' balances
    for (const ledger of all) expect(ledger.rows.at(-1)?.balanceCents ?? ledger.openingCents).toBe(ledger.closingCents);
  });

  it("refuses a file that would hold too many lines, and keeps to the roles and the company", async () => {
    expect(await refusal(getLedgerExport(actor, { accountId: null, ...march }, { maxLines: 5 }))).toBe("reports.tooManyLines");
    expect(await getLedgerExport(actor, { accountId: null, ...march }, { maxLines: 1_000 })).not.toHaveLength(0);
    expect(await refusal(getLedgerExport(intruder, { accountId: null, ...march }))).toBe("forbidden");
    expect(await refusal(getLedgerExport(otherOwner, { accountId: W.bank, ...march }))).toBe("reports.account");
    expect(await refusal(getLedgerExport(actor, { accountId: "pas-un-id", ...march }))).toBe("reports.account");
    expect(await refusal(getLedgerExport(actor, { accountId: null, from: "2026-03-31", to: "2026-03-01" }))).toBe("reports.period");
    expect(await refusal(getLedgerExport(actor, { accountId: null, from: "2026-13-01", to: "2026-12-31" }))).toBe("reports.period");
    const foreign = await getLedgerExport(otherOwner, { accountId: null, ...march });
    expect(foreign.map((ledger) => ledger.account.code).sort()).toEqual(["1000", "4000"]); // B's own, never A's
  });
});

it("revokes financial statements and ledger exports when the accounting module is disabled", async () => {
  await db.query("UPDATE membership SET module_access = $1::jsonb WHERE company_id = $2 AND user_id = $3", [JSON.stringify({ accounting: "none" }), W.companyA, W.userReader]);
  try {
    expect(await refusal(getIncomeStatement(reader, { from: "2026-03-01", to: "2026-03-31" }))).toBe("forbidden");
    expect(await refusal(getBalanceSheet(reader, "2026-03-31"))).toBe("forbidden");
    expect(await refusal(getAccountLedger(reader, { accountId: W.bank, from: "2026-03-01", to: "2026-03-31" }))).toBe("forbidden");
    expect(await refusal(getLedgerExport(reader, { accountId: null, from: "2026-03-01", to: "2026-03-31" }))).toBe("forbidden");
  } finally {
    await db.query("UPDATE membership SET module_access = '{}' WHERE company_id = $1 AND user_id = $2", [W.companyA, W.userReader]);
  }
});
