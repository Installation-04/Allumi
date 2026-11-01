import { getTranslations } from "next-intl/server";
import { listFiscalYears,todayIso } from "@/modules/ledger";
import { getIncomeComparison,incomeComparisonCsv } from "@/modules/reports";
import { loadCompany } from "../../../_lib";
import { comparisonPeriod } from "../../../_comparison-period";
import { comparisonLabels } from "../../../_income-comparison";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
 const {actor,locale}=await loadCompany(params,"ledger.read");const c=await getTranslations("incomeComparison"),t=await getTranslations("statements");
 const periods=comparisonPeriod(Object.fromEntries(new URL(request.url).searchParams),await listFiscalYears(actor),todayIso());
 const report=await getIncomeComparison(actor,periods);
 return new Response(`\uFEFF${incomeComparisonCsv(report,c("title"),comparisonLabels(c,t),locale)}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${c("file")}_${periods.current.from}_${periods.current.to}_${periods.reference.from}_${periods.reference.to}.csv"`,"Cache-Control":"private, no-store"}});
}
