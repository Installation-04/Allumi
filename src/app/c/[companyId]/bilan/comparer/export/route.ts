import { getTranslations } from "next-intl/server";
import { todayIso } from "@/modules/ledger";
import { getBalanceComparison,balanceComparisonCsv } from "@/modules/reports";
import { loadCompany } from "../../../_lib";
import { balanceComparisonDates } from "../../../_balance-comparison-dates";
import { balanceComparisonLabels } from "../../../_balance-comparison";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
 const {actor,locale}=await loadCompany(params,"ledger.read");const c=await getTranslations("balanceComparison"),t=await getTranslations("statements");
 const dates=balanceComparisonDates(Object.fromEntries(new URL(request.url).searchParams),todayIso()),report=await getBalanceComparison(actor,dates);
 return new Response(`\uFEFF${balanceComparisonCsv(report,c("title"),balanceComparisonLabels(c,t),locale)}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${c("file")}_${dates.asOf}_${dates.referenceAsOf}.csv"`,"Cache-Control":"private, no-store"}});
}
