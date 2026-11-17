import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { can } from "@/modules/companies";
import { listFiscalYears, todayIso } from "@/modules/ledger";
import { getTaxComparison, taxComparisonCsv } from "@/modules/reports";
import { loadCompany } from "../../../_lib";
import { taxPeriodQuery } from "../../../_tax-period";
import { taxComparisonPeriod, taxComparisonLabels } from "../../../_tax-comparison";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read"); if (!can(company,"taxes.read")) notFound();
  const periods = taxComparisonPeriod(taxPeriodQuery(new URL(request.url).searchParams), await listFiscalYears(actor), todayIso());
  const report = await getTaxComparison(actor, periods);
  const labels = taxComparisonLabels(await getTranslations("taxComparison"), await getTranslations("taxSummary"));
  return new Response(`\uFEFF${taxComparisonCsv(report,labels,locale)}`, { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="tax_period_comparison.csv"',
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
