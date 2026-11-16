import { notFound } from "next/navigation";
import type { getTranslations } from "next-intl/server";
import { resolveTaxComparisonPeriods, type TaxComparisonLabels } from "@/modules/reports";

export function taxComparisonPeriod(query: Record<string,string|string[]|undefined>, years: readonly { start: string; end: string }[], today: string) {
  try { return resolveTaxComparisonPeriods(query, years, today); }
  catch (error) { if (error instanceof RangeError) notFound(); throw error; }
}

export function taxComparisonLabels(t: Awaited<ReturnType<typeof getTranslations<"taxComparison">>>, s: Awaited<ReturnType<typeof getTranslations<"taxSummary">>>): TaxComparisonLabels {
  return { title: t("title"), current: t("current"), reference: t("reference"), difference: t("difference"), metric: t("metric"), tax: s("tax"), total: s("total"), control: s("control"), reconciliation: t("reconciliation"), anomalies: s("anomalies"), lines: t("lines"), scope: t("scope"), collectedCents: s("collected"), recoverableCents: s("recoverable"), adjustmentCents: s("adjustment"), netCents: s("net"), settlementCents: s("settlement"), movementCents: s("movement") };
}
