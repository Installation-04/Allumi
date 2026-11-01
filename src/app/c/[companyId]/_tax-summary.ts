import type { getTranslations } from "next-intl/server";
import type { TaxSummaryLabels } from "@/modules/reports";
export function taxSummaryLabels(t:Awaited<ReturnType<typeof getTranslations<"taxSummary">>>):TaxSummaryLabels{
 return {tax:t("tax"),collected:t("collected"),recoverable:t("recoverable"),adjustment:t("adjustment"),settlement:t("settlement"),net:t("net"),movement:t("movement"),total:t("total"),control:t("control"),difference:t("difference"),anomalies:t("anomalies"),detail:t("detail"),date:t("date"),entry:t("entry"),account:t("account"),memo:t("memo"),box:t("box"),debit:t("debit"),credit:t("credit"),boxes:{COLLECTED:t("boxes.COLLECTED"),RECOVERABLE:t("boxes.RECOVERABLE"),ADJUSTMENT:t("boxes.ADJUSTMENT"),SETTLEMENT:t("boxes.SETTLEMENT")}};
}
