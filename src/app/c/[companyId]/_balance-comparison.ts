import type { getTranslations } from "next-intl/server";
import type { BalanceComparisonLabels } from "@/modules/reports";
export function balanceComparisonLabels(c:Awaited<ReturnType<typeof getTranslations<"balanceComparison">>>,t:Awaited<ReturnType<typeof getTranslations<"statements">>>):BalanceComparisonLabels{
 return {code:t("code"),account:t("account"),current:c("current"),reference:c("reference"),difference:c("difference"),percent:c("percent"),total:t("total"),control:c("control"),fiscalYearStart:c("fiscalYearStart"),none:c("none"),currentAssets:t("currentAssets"),fixedAssets:t("fixedAssets"),otherAssets:t("otherAssets"),currentLiabilities:t("currentLiabilities"),longTermLiabilities:t("longTermLiabilities"),equity:t("equity"),totalAssets:t("totalAssets"),totalLiabilities:t("totalLiabilities"),priorEarnings:t("priorEarnings"),currentEarnings:t("currentEarnings"),totalEquity:t("totalEquity"),totalLiabilitiesAndEquity:t("totalLiabilitiesAndEquity")};
}
