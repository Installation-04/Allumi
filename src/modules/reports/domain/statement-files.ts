import type { Locale } from "@/modules/ledger/client";
import { csvFormatFor, toCsv, type CsvCell } from "./csv";
import type { BalanceSheet, IncomeStatement, StatementLine, StatementSection } from "./statements";

/** The words of a statement's file, in the language of the person who exports it. */
export type StatementLabels = {
  code: string;
  account: string;
  amount: string;
  total: string;
  operatingRevenue: string;
  costOfSales: string;
  grossProfit: string;
  operatingExpenses: string;
  operatingIncome: string;
  otherRevenue: string;
  otherExpenses: string;
  netIncome: string;
  currentAssets: string;
  fixedAssets: string;
  otherAssets: string;
  totalAssets: string;
  currentLiabilities: string;
  longTermLiabilities: string;
  totalLiabilities: string;
  equity: string;
  priorEarnings: string;
  currentEarnings: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
};

const name = (line: StatementLine, locale: Locale): string => (locale === "en" ? line.nameEn : line.nameFr);

function sectionRows(title: string, part: StatementSection, totalLabel: string, locale: Locale): CsvCell[][] {
  return [[title, "", ""], ...part.lines.map((line): CsvCell[] => [line.code, name(line, locale), line.cents]), ["", totalLabel, part.totalCents]];
}

/** The income statement as a CSV file: a title, the period, then each section with its accounts and its total. */
export function incomeStatementCsv(statement: IncomeStatement, period: { from: string; to: string }, title: string, labels: StatementLabels, locale: Locale): string {
  const rows: CsvCell[][] = [
    [title, "", ""], [`${period.from} → ${period.to}`, "", ""], ["", "", ""], [labels.code, labels.account, labels.amount],
    ...sectionRows(labels.operatingRevenue, statement.operatingRevenue, labels.total, locale),
    ...sectionRows(labels.costOfSales, statement.costOfSales, labels.total, locale),
    ["", labels.grossProfit, statement.grossProfitCents],
    ...sectionRows(labels.operatingExpenses, statement.operatingExpenses, labels.total, locale),
    ["", labels.operatingIncome, statement.operatingIncomeCents],
    ...sectionRows(labels.otherRevenue, statement.otherRevenue, labels.total, locale),
    ...sectionRows(labels.otherExpenses, statement.otherExpenses, labels.total, locale),
    ["", labels.netIncome, statement.netIncomeCents],
  ];
  return toCsv(rows, csvFormatFor(locale));
}

/** The balance sheet as a CSV file: a title, the day, then assets, liabilities and equity with their totals. */
export function balanceSheetCsv(sheet: BalanceSheet, asOf: string, title: string, labels: StatementLabels, locale: Locale): string {
  const rows: CsvCell[][] = [
    [title, "", ""], [asOf, "", ""], ["", "", ""], [labels.code, labels.account, labels.amount],
    ...sectionRows(labels.currentAssets, sheet.currentAssets, labels.total, locale),
    ...sectionRows(labels.fixedAssets, sheet.fixedAssets, labels.total, locale),
    ...sectionRows(labels.otherAssets, sheet.otherAssets, labels.total, locale),
    ["", labels.totalAssets, sheet.totalAssetsCents],
    ...sectionRows(labels.currentLiabilities, sheet.currentLiabilities, labels.total, locale),
    ...sectionRows(labels.longTermLiabilities, sheet.longTermLiabilities, labels.total, locale),
    ["", labels.totalLiabilities, sheet.totalLiabilitiesCents],
    [labels.equity, "", ""],
    ...sheet.equity.lines.map((line): CsvCell[] => [line.code, name(line, locale), line.cents]),
    ["", labels.priorEarnings, sheet.priorEarningsCents],
    ["", labels.currentEarnings, sheet.currentEarningsCents],
    ["", labels.totalEquity, sheet.totalEquityCents],
    ["", labels.totalLiabilitiesAndEquity, sheet.totalLiabilitiesAndEquityCents],
  ];
  return toCsv(rows, csvFormatFor(locale));
}
