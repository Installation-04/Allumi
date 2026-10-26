import type { getTranslations } from "next-intl/server";
import type { AgingLabels } from "@/modules/reports";

/** The words of the aging's CSV file, from the `aging` messages in the language of the person exporting it. */
export function agingLabels(t: Awaited<ReturnType<typeof getTranslations<"aging">>>): AgingLabels {
  return {
    customer: t("customer"), document: t("document"), number: t("number"), date: t("date"), dueDate: t("dueDate"), daysPastDue: t("daysPastDue"),
    current: t("current"), d1_30: t("d1_30"), d31_60: t("d31_60"), d61_90: t("d61_90"), d91_plus: t("d91_plus"), unapplied: t("unapplied"), total: t("total"),
    kinds: { INVOICE: t("kinds.INVOICE"), CREDIT_NOTE: t("kinds.CREDIT_NOTE"), PAYMENT: t("kinds.PAYMENT"), REFUND: t("kinds.REFUND") }, totalLine: t("total"),
  };
}
