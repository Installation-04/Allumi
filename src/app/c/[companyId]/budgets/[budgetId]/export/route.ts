import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getBudgetComparison,budgetCsv } from "@/modules/budgets";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../../_lib";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{companyId:string;budgetId:string}>}) {
  const {actor,locale}=await loadCompany(params,"ledger.read");const {budgetId}=await params;const t=await getTranslations("budgets");
  const r=await getBudgetComparison(actor,budgetId).catch(e=>{
    if(e instanceof AppError&&e.key==="budgets.notFound")notFound();
    if(e instanceof AppError&&e.key==="budgets.tooMany")return null;
    throw e;
  });
  if(!r)return new Response((await getTranslations("errors"))("budgets.tooMany"),{status:422,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  return new Response(`\uFEFF${budgetCsv(r,locale,t)}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="budget_${r.from}_${r.to}.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
