import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listFiscalYears,todayIso } from "@/modules/ledger";
import { getCashMovements,cashMovementsCsv } from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { statementPeriod } from "@/app/_lib/report-period";
import { loadCompany } from "../../_lib";
import { cashAccountId,cashCsvLabels } from "../../_cash-report";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
 const {actor,locale}=await loadCompany(params,"ledger.read"),t=await getTranslations("cashReport");
 const url=new URL(request.url),q=Object.fromEntries(url.searchParams),ids=url.searchParams.getAll("compte"),accountId=cashAccountId(ids.length?ids:undefined),period=statementPeriod(q,await listFiscalYears(actor),todayIso());
 const report=await getCashMovements(actor,{...period,accountId},{allRows:true}).catch(e=>{if(e instanceof AppError&&e.key==="reports.account")notFound();throw e;});
 return new Response(`\uFEFF${cashMovementsCsv(report,t("title"),cashCsvLabels(t),locale)}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${t("file")}_${accountId?report.byAccount[0]!.code:t("allFile")}_${period.from}_${period.to}.csv"`,"Cache-Control":"private, no-store"}});
}
