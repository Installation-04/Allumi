import type { getTranslations } from "next-intl/server";
import type { ComparisonLabels } from "@/modules/reports";
export function comparisonLabels(c:Awaited<ReturnType<typeof getTranslations<"incomeComparison">>>,t:Awaited<ReturnType<typeof getTranslations<"statements">>>):ComparisonLabels{
 return {code:t("code"),account:t("account"),current:c("current"),reference:c("reference"),difference:c("difference"),percent:c("percent"),total:t("total"),operatingRevenue:t("operatingRevenue"),costOfSales:t("costOfSales"),grossProfit:t("grossProfit"),operatingExpenses:t("operatingExpenses"),operatingIncome:t("operatingIncome"),otherRevenue:t("otherRevenue"),otherExpenses:t("otherExpenses"),netIncome:t("netIncome")};
}
