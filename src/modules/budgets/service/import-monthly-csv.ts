import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import { getMonthlyBudgetCopyPreview,readMonthlyBudgetSnapshot,type MonthlyBudgetCopyPreview } from "./duplicate-monthly";
import { MAX_BUDGET_CSV_BYTES } from "../domain/import-csv";
import { MAX_BUDGET_ACCOUNTS } from "../domain/budget";
import { MAX_MONTHLY_IMPORT_ACCOUNTS,MonthlyCsvError,monthlyImportReview,previewMonthlyBudgetCsv,type MonthlyImportAccount } from "../domain/import-monthly-csv";
function importState(s:MonthlyBudgetCopyPreview){
  const accounts:MonthlyImportAccount[]=s.targets.map(a=>({id:a.accountId,code:a.code,nameFr:a.nameFr,nameEn:a.nameEn,type:a.type,isActive:a.isActive,annualCents:a.amountCents.toString(),months:s.periods.map(p=>a.months.find(m=>m.periodId===p.id)?.amountCents.toString()??null)}));
  return {...s.source,periods:s.periods,stateToken:s.stateToken,accounts};
}
export async function getMonthlyBudgetImportState(actor:CompanyContext,budgetId:string){return importState(await getMonthlyBudgetCopyPreview(actor,budgetId));}
export type MonthlyBudgetImportState=Awaited<ReturnType<typeof getMonthlyBudgetImportState>>;
const inputSchema=z.object({revision:z.number().int().positive().max(2147483647),stateToken:z.string().regex(/^[a-f0-9]{64}$/),format:z.enum(["en","fr-CA"]),text:z.string().max(MAX_BUDGET_CSV_BYTES),confirmed:z.literal(true),review:z.array(z.object({accountId:z.uuid(),accountCode:z.string().max(20),months:z.array(z.string().regex(/^\d{1,15}$/).nullable()).length(12)}).strict()).min(1).max(MAX_MONTHLY_IMPORT_ACCOUNTS)}).strict();
/** Only listed accounts are replaced. Their annual targets and all other accounts stay intact. */
export async function importMonthlyBudgetCsv(actor:CompanyContext,budgetId:string,input:z.input<typeof inputSchema>):Promise<string>{
  const parsed=inputSchema.safeParse(input);if(!z.uuid().safeParse(budgetId).success||!parsed.success)throw new AppError("budgets.monthlyImportInvalid");
  const data=parsed.data;
  return withCompany(actor,async tx=>{
    await requireRole(tx,"budget.manage");
    const [budget]=await tx.$queryRaw<{revision:number;fiscal_year_id:string}[]>`SELECT revision,fiscal_year_id FROM budget WHERE company_id=${actor.companyId}::uuid AND id=${budgetId}::uuid FOR UPDATE`;
    if(!budget)throw new AppError("budgets.notFound");if(budget.revision!==data.revision)throw new AppError("budgets.monthlyImportStale");
    await tx.$queryRaw`SELECT a.id FROM account a JOIN budget_line l ON l.company_id=a.company_id AND l.account_id=a.id WHERE l.company_id=${actor.companyId}::uuid AND l.budget_id=${budgetId}::uuid ORDER BY a.id LIMIT ${MAX_BUDGET_ACCOUNTS+1} FOR SHARE OF a`;
    await tx.$queryRaw`SELECT id FROM fiscal_year WHERE company_id=${actor.companyId}::uuid AND id=${budget.fiscal_year_id}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM fiscal_period WHERE company_id=${actor.companyId}::uuid AND fiscal_year_id=${budget.fiscal_year_id}::uuid ORDER BY id FOR SHARE`;
    const snapshot=await readMonthlyBudgetSnapshot(tx,actor,budgetId,null),state=importState(snapshot);
    if(state.stateToken!==data.stateToken)throw new AppError("budgets.monthlyImportStale");
    let rows;
    try{rows=previewMonthlyBudgetCsv(data.text,data.format,state.accounts);}catch(e){if(e instanceof MonthlyCsvError)throw new AppError("budgets.monthlyImportInvalid");throw e;}
    if(JSON.stringify(monthlyImportReview(rows))!==JSON.stringify(data.review))throw new AppError("budgets.monthlyImportChanged");
    const lines=await tx.budgetLine.findMany({where:{companyId:actor.companyId,budgetId,accountId:{in:rows.map(r=>r.accountId)}},select:{id:true,accountId:true}});
    if(lines.length!==rows.length)throw new AppError("budgets.monthlyImportStale");
    const ids=new Map(lines.map(l=>[l.accountId,l.id]));
    await tx.budgetMonthlyTarget.deleteMany({where:{companyId:actor.companyId,budgetLineId:{in:lines.map(l=>l.id)}}});
    const targets=rows.flatMap(r=>r.months.flatMap((v,i)=>v===null?[]:[{companyId:actor.companyId,budgetLineId:ids.get(r.accountId)!,fiscalPeriodId:state.periods[i]!.id,amountCents:v}]));
    for(let offset=0;offset<targets.length;offset+=500)await tx.budgetMonthlyTarget.createMany({data:targets.slice(offset,offset+500)});
    await recordEvent(tx,{action:"budget.import_monthly_csv",entityType:"budget",entityId:budgetId,data:{format:data.format,sourceRevision:budget.revision,contentSha256:createHash("sha256").update(data.text).digest("hex"),accountIds:rows.map(r=>r.accountId),replacedMonthlyCount:rows.reduce((n,r)=>n+r.before.filter(v=>v!==null).length,0),definedMonthlyCount:targets.length,changedCount:rows.reduce((n,r)=>n+r.changedCount,0),removedCount:rows.reduce((n,r)=>n+r.removedCount,0),periodIds:state.periods.map(p=>p.id)}});
    return state.periods[0]!.id;
  },"bounded-bulk");
}
