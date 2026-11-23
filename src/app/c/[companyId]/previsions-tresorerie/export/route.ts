import { notFound } from "next/navigation";
import { can } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { getCashForecast,cashForecastCsv } from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { getTranslations } from "@/platform/i18n/server";
import { forecastFilters } from "@/app/_lib/cash-forecast";
import { loadCompany } from "../../_lib";
import { forecastCsvLabels } from "../../_cash-forecast";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
 const {company,actor,locale}=await loadCompany(params,"ledger.read");if(!can(company,"sales.read"))notFound();
 const t=await getTranslations("cashForecast"),errors=await getTranslations("errors"),url=new URL(request.url);
 const q=Object.fromEntries([...url.searchParams.keys()].map(k=>[k,url.searchParams.getAll(k).length>1?url.searchParams.getAll(k):url.searchParams.get(k)!]));
 try{
  const filters=forecastFilters(q,todayIso()),report=await getCashForecast(actor,filters,{allRows:true});
  return new Response(`\uFEFF${cashForecastCsv(report,forecastCsvLabels(t),locale)}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${t("file")}_${report.asOf}_${report.to}.csv"`,"Cache-Control":"private, no-store"}});
 }catch(e){if(e instanceof AppError&&["reports.forecastDate","reports.forecastLimit","reports.forecastSource"].includes(e.key))return new Response(errors(e.key as "reports.forecastDate"),{status:e.key==="reports.forecastLimit"?413:e.key==="reports.forecastSource"?409:400,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"private, no-store"}});throw e;}
}
