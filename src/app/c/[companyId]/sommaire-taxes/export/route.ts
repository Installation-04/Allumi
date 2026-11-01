import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listFiscalYears,todayIso } from "@/modules/ledger";
import { getTaxSummary,taxSummaryCsv } from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { statementPeriod } from "@/app/_lib/report-period";
import { loadCompany } from "../../_lib";
import { taxSummaryLabels } from "../../_tax-summary";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
 const {company,actor,locale}=await loadCompany(params,"ledger.read");if(!can(company,"taxes.read"))notFound();
 const t=await getTranslations("taxSummary");
 const period=statementPeriod(Object.fromEntries(new URL(request.url).searchParams),await listFiscalYears(actor),todayIso());
 try{
  const report=await getTaxSummary(actor,period,{exportAll:true});
  return new Response(`\uFEFF${taxSummaryCsv(report,t("title"),taxSummaryLabels(t),locale)}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${t("file")}_${period.from}_${period.to}.csv"`,"Cache-Control":"private, no-store"}});
 }catch(error){if(error instanceof AppError&&error.key==="reports.tooManyLines")return new Response(t("tooManyLines"),{status:413,headers:{"Cache-Control":"no-store"}});throw error;}
}
