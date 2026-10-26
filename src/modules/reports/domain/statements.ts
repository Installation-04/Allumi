import { naturalBalance, type AccountSubtype, type AccountType } from "@/modules/ledger/client";

/** The debit and credit totals of one account over the dates a statement covers. */
export type AccountTotals = {
  accountId: string;
  code: string;
  nameFr: string;
  nameEn: string;
  type: AccountType;
  subtype: AccountSubtype;
  debitCents: bigint;
  creditCents: bigint;
};

/** One account of a statement: its balance in the direction its type normally holds (a loss, or a contra account, is negative). */
export type StatementLine = { accountId: string; code: string; nameFr: string; nameEn: string; cents: bigint };

export type StatementSection = { lines: StatementLine[]; totalCents: bigint };

const sum = (values: readonly bigint[]): bigint => values.reduce((total, value) => total + value, 0n);

/** The accounts of these subtypes (of this type, when one is given), without those that net to zero unless asked, by code. */
function section(rows: readonly AccountTotals[], match: (row: AccountTotals) => boolean, includeZero: boolean): StatementSection {
  const lines = rows
    .filter(match)
    .map((row) => ({ accountId: row.accountId, code: row.code, nameFr: row.nameFr, nameEn: row.nameEn, cents: naturalBalance(row.type, row) }))
    .filter((line) => includeZero || line.cents !== 0n)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { lines, totalCents: sum(lines.map((line) => line.cents)) };
}

const subtypeIn = (type: AccountType, ...subtypes: AccountSubtype[]) => (row: AccountTotals) => row.type === type && subtypes.includes(row.subtype);

// ---------------------------------------------------------------- income statement

export type IncomeStatement = {
  operatingRevenue: StatementSection;
  costOfSales: StatementSection;
  grossProfitCents: bigint;
  operatingExpenses: StatementSection;
  operatingIncomeCents: bigint;
  otherRevenue: StatementSection;
  otherExpenses: StatementSection;
  netIncomeCents: bigint;
};

/**
 * The income statement of a period from the totals of its revenue and expense accounts over that period: operating
 * revenue less cost of sales is the gross profit, less operating expenses the operating income, plus other revenue
 * less other expenses the net income. Balance sheet accounts in the rows are ignored.
 */
export function buildIncomeStatement(rows: readonly AccountTotals[], options: { includeZero?: boolean } = {}): IncomeStatement {
  const zero = options.includeZero ?? false;
  const operatingRevenue = section(rows, subtypeIn("REVENUE", "OPERATING_REVENUE"), zero);
  const costOfSales = section(rows, subtypeIn("EXPENSE", "COST_OF_SALES"), zero);
  const operatingExpenses = section(rows, subtypeIn("EXPENSE", "OPERATING_EXPENSE"), zero);
  const otherRevenue = section(rows, subtypeIn("REVENUE", "OTHER_REVENUE"), zero);
  const otherExpenses = section(rows, subtypeIn("EXPENSE", "OTHER_EXPENSE"), zero);
  const grossProfitCents = operatingRevenue.totalCents - costOfSales.totalCents;
  const operatingIncomeCents = grossProfitCents - operatingExpenses.totalCents;
  return { operatingRevenue, costOfSales, grossProfitCents, operatingExpenses, operatingIncomeCents, otherRevenue, otherExpenses, netIncomeCents: operatingIncomeCents + otherRevenue.totalCents - otherExpenses.totalCents };
}

// ---------------------------------------------------------------- balance sheet

export type BalanceSheet = {
  currentAssets: StatementSection;
  fixedAssets: StatementSection;
  otherAssets: StatementSection;
  totalAssetsCents: bigint;
  currentLiabilities: StatementSection;
  longTermLiabilities: StatementSection;
  totalLiabilitiesCents: bigint;
  /** The equity accounts themselves (capital, retained earnings). */
  equity: StatementSection;
  /** What the years before the current one earned and no closing entry moved to equity. */
  priorEarningsCents: bigint;
  /** What the current fiscal year has earned so far. */
  currentEarningsCents: bigint;
  totalEquityCents: bigint;
  totalLiabilitiesAndEquityCents: bigint;
  /** Assets equal liabilities plus equity: always true of a sound ledger, and a false would be an incident. */
  balanced: boolean;
};

/**
 * The balance sheet at a day from the totals of every account up to that day. Revenue and expense accounts are never
 * closed to equity by an entry, so what they have earned is added to equity: the earnings before the current fiscal
 * year (`priorEarningsCents`, what revenue less expenses came to up to the day before it began) and those since.
 */
export function buildBalanceSheet(rows: readonly AccountTotals[], options: { priorEarningsCents?: bigint; includeZero?: boolean } = {}): BalanceSheet {
  const zero = options.includeZero ?? false;
  const currentAssets = section(rows, subtypeIn("ASSET", "CASH", "BANK", "ACCOUNTS_RECEIVABLE", "CURRENT_ASSET", "SALES_TAX"), zero);
  const fixedAssets = section(rows, subtypeIn("ASSET", "FIXED_ASSET"), zero);
  const otherAssets = section(rows, subtypeIn("ASSET", "OTHER_ASSET"), zero);
  const currentLiabilities = section(rows, subtypeIn("LIABILITY", "CREDIT_CARD", "ACCOUNTS_PAYABLE", "SALES_TAX", "CURRENT_LIABILITY"), zero);
  const longTermLiabilities = section(rows, subtypeIn("LIABILITY", "LONG_TERM_LIABILITY"), zero);
  const equity = section(rows, (row) => row.type === "EQUITY", zero);
  const totalEarnings = sum(rows.filter((row) => row.type === "REVENUE" || row.type === "EXPENSE").map((row) => row.creditCents - row.debitCents));
  const priorEarningsCents = options.priorEarningsCents ?? 0n;
  const totalAssetsCents = currentAssets.totalCents + fixedAssets.totalCents + otherAssets.totalCents;
  const totalLiabilitiesCents = currentLiabilities.totalCents + longTermLiabilities.totalCents;
  const totalEquityCents = equity.totalCents + totalEarnings;
  return {
    currentAssets, fixedAssets, otherAssets, totalAssetsCents, currentLiabilities, longTermLiabilities, totalLiabilitiesCents,
    equity, priorEarningsCents, currentEarningsCents: totalEarnings - priorEarningsCents, totalEquityCents,
    totalLiabilitiesAndEquityCents: totalLiabilitiesCents + totalEquityCents,
    balanced: totalAssetsCents === totalLiabilitiesCents + totalEquityCents,
  };
}
