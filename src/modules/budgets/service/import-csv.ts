import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { AppError,isConflict } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import { budgetInput,MAX_BUDGET_ACCOUNTS } from "../domain/budget";
import { readBudgetCsv,BudgetCsvError,MAX_IMPORT_CHART_ACCOUNTS,type ImportAccount } from "../domain/import-csv";
type Account=Omit<ImportAccount,"stateToken">;
const columns={id:true,code:true,nameFr:true,nameEn:true,type:true,isActive:true} as const;
// An optimistic review fingerprint, not an authorization token. Role, scope and eligibility are always checked.
function state(a:Account):string{return createHash("sha256").update(JSON.stringify([a.id,a.code,a.nameFr,a.nameEn,a.type,a.isActive])).digest("hex");}
export async function getBudgetImportAccounts(actor:CompanyContext):Promise<ImportAccount[]>{
  return withCompany(actor,async tx=>{
    await requireRole(tx,"budget.manage");
    const accounts=await tx.account.findMany({where:{companyId:actor.companyId},select:columns,orderBy:{code:"asc"},take:MAX_IMPORT_CHART_ACCOUNTS+1});
    if(accounts.length>MAX_IMPORT_CHART_ACCOUNTS)throw new AppError("budgets.importChartLimit");
    return accounts.map(a=>({...a,stateToken:state(a)}));
  });
}
const inputSchema=budgetInput.extend({format:z.enum(["en","fr-CA"]),text:z.string().max(256*1024),review:z.array(z.object({accountId:z.uuid(),accountCode:z.string().max(20),amountCents:z.string().regex(/^\d{1,15}$/),stateToken:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(MAX_BUDGET_ACCOUNTS)});
export async function importBudgetCsv(actor:CompanyContext,input:z.input<typeof inputSchema>):Promise<string>{
  const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new AppError("budgets.importInvalid");
  const data=parsed.data;
  try{return await withCompany(actor,async tx=>{
    await requireRole(tx,"budget.manage");
    let rows;try{rows=readBudgetCsv(data.text,data.format);}catch(e){if(e instanceof BudgetCsvError)throw new AppError("budgets.importInvalid");throw e;}
    if(rows.length!==data.review.length||rows.some((r,i)=>r.accountCode!==data.review[i]?.accountCode||r.amountCents.toString()!==data.review[i]?.amountCents))throw new AppError("budgets.importChanged");
    const codes=rows.map(r=>r.accountCode);
    const accounts=await tx.$queryRaw<Account[]>`SELECT id,code,name_fr AS "nameFr",name_en AS "nameEn",type,is_active AS "isActive" FROM account WHERE company_id=${actor.companyId}::uuid AND code=ANY(${codes}::text[]) ORDER BY id FOR SHARE`;
    const byCode=new Map(accounts.map(a=>[a.code,a]));
    for(const r of data.review){const a=byCode.get(r.accountCode);if(!a||!a.isActive||(a.type!=="REVENUE"&&a.type!=="EXPENSE")||a.id!==r.accountId||state(a)!==r.stateToken)throw new AppError("budgets.importStale");}
    const year=await tx.fiscalYear.findFirst({where:{companyId:actor.companyId,id:data.fiscalYearId},select:{startDate:true,endDate:true}});
    if(!year)throw new AppError("budgets.year");
    // Existing activity without targets also occupies rows in the full-year comparison.
    const [coverage]=await tx.$queryRaw<{count:number}[]>`SELECT count(*)::int AS count FROM (
      SELECT unnest(${accounts.map(a=>a.id)}::uuid[]) AS account_id
      UNION SELECT l.account_id FROM journal_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
      WHERE l.company_id=${actor.companyId}::uuid AND a.type IN ('REVENUE','EXPENSE')
        AND l.entry_date BETWEEN ${year.startDate.toISOString().slice(0,10)}::date AND ${year.endDate.toISOString().slice(0,10)}::date
    ) present`;
    if(!coverage||coverage.count>MAX_BUDGET_ACCOUNTS)throw new AppError("budgets.tooMany");
    const destination=await tx.budget.create({data:{companyId:actor.companyId,fiscalYearId:data.fiscalYearId,name:data.name},select:{id:true}});
    await tx.budgetLine.createMany({data:rows.map(r=>({companyId:actor.companyId,budgetId:destination.id,accountId:byCode.get(r.accountCode)!.id,amountCents:r.amountCents}))});
    await recordEvent(tx,{action:"budget.import_csv",entityType:"budget",entityId:destination.id,data:{format:data.format,targetCount:rows.length,contentSha256:createHash("sha256").update(data.text).digest("hex")}});
    return destination.id;
  });}catch(e){if(isConflict(e))throw new AppError("budgets.duplicate");throw e;}
}
