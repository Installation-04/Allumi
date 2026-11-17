import { budgetCsvTemplate } from "@/modules/budgets";
import { loadCompany } from "../../../_lib";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
  await loadCompany(params,"budget.manage");
  const formats=new URL(request.url).searchParams.getAll("format"),format=formats[0];
  const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
  if(formats.length!==1||(format!=="en"&&format!=="fr-CA"))return new Response(null,{status:400,headers});
  return new Response(budgetCsvTemplate(format),{headers:{...headers,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="annual_budget_template_${format}.csv"`}});
}
