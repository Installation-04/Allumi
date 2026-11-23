import { notFound } from "next/navigation";
import { AppError } from "@/platform/errors";
import { getMonthlyBudgetImportState,monthlyBudgetCsvTemplate } from "@/modules/budgets";
import { loadCompany } from "../../../../../_lib";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string;budgetId:string}>}){
 const {actor}=await loadCompany(params,"budget.manage"),{budgetId}=await params;
 await getMonthlyBudgetImportState(actor,budgetId).catch(e=>{if(e instanceof AppError&&["budgets.notFound","budgets.invalid"].includes(e.key))notFound();throw e;});
 const query=new URL(request.url).searchParams,formats=query.getAll("format"),format=formats[0],headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
 if([...query.keys()].some(k=>k!=="format")||formats.length!==1||(format!=="en"&&format!=="fr-CA"))return new Response(null,{status:400,headers});
 return new Response(monthlyBudgetCsvTemplate(format),{headers:{...headers,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="monthly_budget_template_${format}.csv"`}});
}
