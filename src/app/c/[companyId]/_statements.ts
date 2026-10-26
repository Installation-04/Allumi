import type { getTranslations } from "next-intl/server";
import type { StatementLabels } from "@/modules/reports";

/** The words of a statement's CSV file, from the `statements` messages in the language of the person exporting it. */
export function statementLabels(t: Awaited<ReturnType<typeof getTranslations<"statements">>>): StatementLabels {
  return {
    code: t("code"), account: t("account"), amount: t("amount"), total: t("total"),
    operatingRevenue: t("operatingRevenue"), costOfSales: t("costOfSales"), grossProfit: t("grossProfit"), operatingExpenses: t("operatingExpenses"),
    operatingIncome: t("operatingIncome"), otherRevenue: t("otherRevenue"), otherExpenses: t("otherExpenses"), netIncome: t("netIncome"),
    currentAssets: t("currentAssets"), fixedAssets: t("fixedAssets"), otherAssets: t("otherAssets"), totalAssets: t("totalAssets"),
    currentLiabilities: t("currentLiabilities"), longTermLiabilities: t("longTermLiabilities"), totalLiabilities: t("totalLiabilities"),
    equity: t("equity"), priorEarnings: t("priorEarnings"), currentEarnings: t("currentEarnings"), totalEquity: t("totalEquity"), totalLiabilitiesAndEquity: t("totalLiabilitiesAndEquity"),
  };
}
