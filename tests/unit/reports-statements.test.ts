import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACCOUNT_SUBTYPES, SUBTYPES_OF, type AccountSubtype, type AccountType } from "@/modules/ledger/client";
import { balanceSheetCsv, buildBalanceSheet, buildIncomeStatement, csvAmount, csvFormatFor, csvText, incomeStatementCsv, toCsv, type AccountTotals, type StatementLabels } from "@/modules/reports";

const account = (code: string, type: AccountType, subtype: AccountSubtype, debitCents: bigint, creditCents: bigint, name = `Compte ${code}`): AccountTotals => ({
  accountId: `id-${code}`, code, nameFr: name, nameEn: `Account ${code}`, type, subtype, debitCents, creditCents,
});

describe("the income statement", () => {
  const rows = [
    account("4000", "REVENUE", "OPERATING_REVENUE", 0n, 100_000n),
    account("4100", "REVENUE", "OPERATING_REVENUE", 500n, 20_500n), // 200,00 net
    account("5000", "EXPENSE", "COST_OF_SALES", 30_000n, 0n),
    account("6000", "EXPENSE", "OPERATING_EXPENSE", 12_000n, 2_000n), // 100,00 net
    account("4910", "REVENUE", "OTHER_REVENUE", 0n, 1_000n),
    account("7000", "EXPENSE", "OTHER_EXPENSE", 2_500n, 0n),
    account("1000", "ASSET", "BANK", 999_999n, 0n), // a balance sheet account is not part of it
    account("6010", "EXPENSE", "OPERATING_EXPENSE", 700n, 700n), // nets to zero: left out
  ];
  it("adds up revenue, cost of sales, expenses and other items, each in its own direction", () => {
    const statement = buildIncomeStatement(rows);
    expect(statement.operatingRevenue.totalCents).toBe(120_000n);
    expect(statement.operatingRevenue.lines.map((line) => [line.code, line.cents])).toEqual([["4000", 100_000n], ["4100", 20_000n]]);
    expect(statement.costOfSales.totalCents).toBe(30_000n);
    expect(statement.grossProfitCents).toBe(90_000n);
    expect(statement.operatingExpenses.totalCents).toBe(10_000n);
    expect(statement.operatingIncomeCents).toBe(80_000n);
    expect(statement.otherRevenue.totalCents).toBe(1_000n);
    expect(statement.otherExpenses.totalCents).toBe(2_500n);
    expect(statement.netIncomeCents).toBe(78_500n);
  });
  it("leaves out an account that nets to zero unless asked, and keeps a loss or a refund negative", () => {
    expect(buildIncomeStatement(rows).operatingExpenses.lines.map((line) => line.code)).toEqual(["6000"]);
    expect(buildIncomeStatement(rows, { includeZero: true }).operatingExpenses.lines.map((line) => line.code)).toEqual(["6000", "6010"]);
    const loss = buildIncomeStatement([account("4000", "REVENUE", "OPERATING_REVENUE", 5_000n, 1_000n), account("6000", "EXPENSE", "OPERATING_EXPENSE", 2_000n, 0n)]);
    expect(loss.operatingRevenue.totalCents).toBe(-4_000n); // more refunded than sold
    expect(loss.netIncomeCents).toBe(-6_000n);
  });
  it("is empty without lines, and sorts its accounts by code", () => {
    expect(buildIncomeStatement([]).netIncomeCents).toBe(0n);
    const statement = buildIncomeStatement([account("4200", "REVENUE", "OPERATING_REVENUE", 0n, 1n), account("4001", "REVENUE", "OPERATING_REVENUE", 0n, 1n), account("4100", "REVENUE", "OPERATING_REVENUE", 0n, 1n)]);
    expect(statement.operatingRevenue.lines.map((line) => line.code)).toEqual(["4001", "4100", "4200"]);
  });
});

describe("the balance sheet", () => {
  it("groups assets, liabilities and equity, and adds the earnings to equity", () => {
    const rows = [
      account("1000", "ASSET", "BANK", 150_000n, 0n),
      account("1100", "ASSET", "ACCOUNTS_RECEIVABLE", 40_000n, 0n),
      account("1500", "ASSET", "FIXED_ASSET", 60_000n, 5_000n),
      account("1900", "ASSET", "OTHER_ASSET", 1_000n, 0n),
      account("2000", "LIABILITY", "ACCOUNTS_PAYABLE", 0n, 20_000n),
      account("2100", "LIABILITY", "SALES_TAX", 0n, 3_000n),
      account("2500", "LIABILITY", "LONG_TERM_LIABILITY", 0n, 50_000n),
      account("3000", "EQUITY", "EQUITY", 0n, 100_000n),
      account("4000", "REVENUE", "OPERATING_REVENUE", 0n, 90_000n),
      account("5000", "EXPENSE", "OPERATING_EXPENSE", 63_000n, 0n),
    ];
    const sheet = buildBalanceSheet(rows, { priorEarningsCents: 10_000n });
    expect(sheet.currentAssets.totalCents).toBe(190_000n);
    expect(sheet.fixedAssets.totalCents).toBe(55_000n); // net of its credit
    expect(sheet.otherAssets.totalCents).toBe(1_000n);
    expect(sheet.totalAssetsCents).toBe(246_000n);
    expect(sheet.currentLiabilities.totalCents).toBe(23_000n);
    expect(sheet.longTermLiabilities.totalCents).toBe(50_000n);
    expect(sheet.totalLiabilitiesCents).toBe(73_000n);
    expect(sheet.equity.totalCents).toBe(100_000n);
    expect(sheet.priorEarningsCents).toBe(10_000n);
    expect(sheet.currentEarningsCents).toBe(17_000n); // 27,000 earned in all, 10,000 of it before this year
    expect(sheet.totalEquityCents).toBe(127_000n);
    expect(sheet.totalLiabilitiesAndEquityCents).toBe(200_000n);
    expect(sheet.balanced).toBe(false); // these rows are not a whole ledger: the assets do not match
  });
  it("puts a sales-tax account on the side of its type", () => {
    const sheet = buildBalanceSheet([account("1200", "ASSET", "SALES_TAX", 500n, 0n), account("2100", "LIABILITY", "SALES_TAX", 0n, 900n)]);
    expect(sheet.currentAssets.lines.map((line) => line.code)).toEqual(["1200"]);
    expect(sheet.currentLiabilities.lines.map((line) => line.code)).toEqual(["2100"]);
  });
  it("balances for any ledger whatever the accounts and the earnings split", () => {
    const kinds: { type: AccountType; subtype: AccountSubtype }[] = ACCOUNT_SUBTYPES.flatMap((subtype) => (Object.keys(SUBTYPES_OF) as AccountType[]).filter((type) => SUBTYPES_OF[type].includes(subtype)).map((type) => ({ type, subtype })));
    const amount = fc.bigInt({ min: 1n, max: 1_000_000_000n });
    // a balanced entry between two accounts of any kind, repeated
    const entry = fc.record({ debit: fc.integer({ min: 0, max: kinds.length - 1 }), credit: fc.integer({ min: 0, max: kinds.length - 1 }), cents: amount });
    fc.assert(fc.property(fc.array(entry, { maxLength: 40 }), fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }), (entries, prior) => {
      const totals = new Map<number, { debit: bigint; credit: bigint }>();
      for (const item of entries) {
        const d = totals.get(item.debit) ?? { debit: 0n, credit: 0n };
        d.debit += item.cents;
        totals.set(item.debit, d);
        const c = totals.get(item.credit) ?? { debit: 0n, credit: 0n };
        c.credit += item.cents;
        totals.set(item.credit, c);
      }
      const rows = [...totals].map(([index, sums]) => account(String(1000 + index), kinds[index]?.type ?? "ASSET", kinds[index]?.subtype ?? "BANK", sums.debit, sums.credit));
      const sheet = buildBalanceSheet(rows, { priorEarningsCents: prior });
      expect(sheet.balanced).toBe(true);
      expect(sheet.priorEarningsCents + sheet.currentEarningsCents).toBe(rows.filter((r) => r.type === "REVENUE" || r.type === "EXPENSE").reduce((s, r) => s + r.creditCents - r.debitCents, 0n));
      expect(sheet.totalLiabilitiesAndEquityCents).toBe(sheet.totalAssetsCents);
    }));
  });
  it("is empty without lines", () => {
    const sheet = buildBalanceSheet([]);
    expect(sheet).toMatchObject({ totalAssetsCents: 0n, totalEquityCents: 0n, balanced: true });
  });
});

describe("CSV", () => {
  const fr = csvFormatFor("fr-CA");
  const en = csvFormatFor("en");
  it("writes amounts in exact cents with the language's decimal mark and no grouping", () => {
    expect(csvAmount(123_456n, fr)).toBe("1234,56");
    expect(csvAmount(123_456n, en)).toBe("1234.56");
    expect(csvAmount(5n, fr)).toBe("0,05");
    expect(csvAmount(-5n, en)).toBe("-0.05");
    expect(csvAmount(0n, fr)).toBe("0,00");
    expect(csvAmount(-100_000_000_000_001n, en)).toBe("-1000000000000.01");
    fc.assert(fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (cents) => {
      const read = csvAmount(cents, en);
      const [whole = "", fraction = ""] = read.replace("-", "").split(".");
      expect(fraction).toHaveLength(2);
      expect((read.startsWith("-") ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction))).toBe(cents);
    }));
  });
  it("quotes what holds the delimiter, a quote or a line break, and defuses what a spreadsheet would run as a formula", () => {
    expect(csvText("Ventes, détail", en)).toBe('"Ventes, détail"');
    expect(csvText("Ventes, détail", fr)).toBe("Ventes, détail"); // the French delimiter is the semicolon
    expect(csvText("a;b", fr)).toBe('"a;b"');
    expect(csvText('dit "oui"', en)).toBe('"dit ""oui"""');
    expect(csvText("ligne\nsuivante", en)).toBe('"ligne\nsuivante"');
    for (const hostile of ["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\t=1", "\r=1"]) expect(csvText(hostile, en).replace(/^"/, "")).toMatch(/^'/);
    expect(csvText("Frais 5=5", en)).toBe("Frais 5=5");
  });
  it("ends every line with CRLF, amounts as numbers and texts as texts", () => {
    expect(toCsv([["Compte", "Montant"], ["Ventes", 150_000n], ["=1+1", -5n]], fr)).toBe("Compte;Montant\r\nVentes;1500,00\r\n'=1+1;-0,05\r\n");
  });
  const labels = Object.fromEntries(["code", "account", "amount", "total", "operatingRevenue", "costOfSales", "grossProfit", "operatingExpenses", "operatingIncome", "otherRevenue", "otherExpenses", "netIncome", "currentAssets", "fixedAssets", "otherAssets", "totalAssets", "currentLiabilities", "longTermLiabilities", "totalLiabilities", "equity", "priorEarnings", "currentEarnings", "totalEquity", "totalLiabilitiesAndEquity"].map((key) => [key, `L:${key}`])) as StatementLabels;
  it("exports the income statement with its sections, accounts and totals", () => {
    const statement = buildIncomeStatement([account("4000", "REVENUE", "OPERATING_REVENUE", 0n, 100_050n, "Ventes"), account("6000", "EXPENSE", "OPERATING_EXPENSE", 50n, 0n, "=Loyer")]);
    const lines = incomeStatementCsv(statement, { from: "2026-01-01", to: "2026-12-31" }, "Résultats", labels, "fr-CA").split("\r\n");
    expect(lines[0]).toBe("Résultats;;");
    expect(lines[1]).toBe("2026-01-01 → 2026-12-31;;");
    expect(lines).toContain("4000;Ventes;1000,50");
    expect(lines).toContain("6000;'=Loyer;0,50");
    expect(lines).toContain(";L:operatingIncome;1000,00");
    expect(lines).toContain(";L:netIncome;1000,00");
    expect(lines.at(-1)).toBe("");
  });
  it("exports the balance sheet in English with its totals", () => {
    const sheet = buildBalanceSheet([account("1000", "ASSET", "BANK", 10_000n, 0n), account("3000", "EQUITY", "EQUITY", 0n, 10_000n)]);
    const lines = balanceSheetCsv(sheet, "2026-03-31", "Balance sheet", labels, "en").split("\r\n");
    expect(lines).toContain("1000,Account 1000,100.00");
    expect(lines).toContain(",L:totalAssets,100.00");
    expect(lines).toContain(",L:totalLiabilitiesAndEquity,100.00");
  });
});
