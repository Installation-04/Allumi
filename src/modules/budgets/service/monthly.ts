import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import { MAX_BUDGET_ACCOUNTS } from "../domain/budget";
import { allocationSummary,monthlyAllocationInput } from "../domain/monthly";
type Period={id:string;number:number;from:string;to:string};
type Amount={periodId:string;targetCents:string|null;actualCents:string;hasActivity:boolean};
type RawAccount={accountId:string;lineId:string|null;code:string;nameFr:string;nameEn:string;type:"REVENUE"|"EXPENSE";isActive:boolean;annualCents:string|null;months:Amount[]};
type Header={id:string;name:string;revision:number;from:string;to:string};
async function plan(actor:CompanyContext,id:string,accountId?:string){
 if(!z.uuid().safeParse(id).success||(accountId&&!z.uuid().safeParse(accountId).success))throw new AppError("budgets.notFound");
 return withCompany(actor,async tx=>{
  await requireRole(tx,"ledger.read");
  const [r]=await tx.$queryRaw<{budget:Header;periods:Period[];accounts:RawAccount[]}[]>`
   WITH chosen AS(SELECT b.*,f.start_date,f.end_date FROM budget b JOIN fiscal_year f ON f.company_id=b.company_id AND f.id=b.fiscal_year_id WHERE b.company_id=${actor.companyId}::uuid AND b.id=${id}::uuid),
   periods AS(SELECT p.* FROM fiscal_period p JOIN chosen c ON c.company_id=p.company_id AND c.fiscal_year_id=p.fiscal_year_id),
   actual AS(SELECT l.account_id,p.id AS period_id,(sum(CASE WHEN a.type='REVENUE' THEN l.credit_cents-l.debit_cents ELSE l.debit_cents-l.credit_cents END))::text AS cents,count(*) AS activity
    FROM journal_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id JOIN periods p ON p.company_id=l.company_id AND l.entry_date BETWEEN p.start_date AND p.end_date
    WHERE l.company_id=${actor.companyId}::uuid AND a.type IN ('REVENUE','EXPENSE') AND (${accountId??null}::uuid IS NULL OR a.id=${accountId??null}::uuid) GROUP BY l.account_id,p.id),
   candidates AS(SELECT a.*,l.id AS line_id,l.amount_cents AS annual FROM account a CROSS JOIN chosen c LEFT JOIN budget_line l ON l.company_id=a.company_id AND l.account_id=a.id AND l.budget_id=c.id
    WHERE a.company_id=c.company_id AND a.type IN ('REVENUE','EXPENSE') AND (${accountId??null}::uuid IS NULL OR a.id=${accountId??null}::uuid) AND (l.id IS NOT NULL OR EXISTS(SELECT 1 FROM actual x WHERE x.account_id=a.id)) ORDER BY a.code LIMIT ${MAX_BUDGET_ACCOUNTS+1})
   SELECT jsonb_build_object('id',c.id,'name',c.name,'revision',c.revision,'from',to_char(c.start_date,'YYYY-MM-DD'),'to',to_char(c.end_date,'YYYY-MM-DD')) AS budget,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'number',p.period_number,'from',to_char(p.start_date,'YYYY-MM-DD'),'to',to_char(p.end_date,'YYYY-MM-DD')) ORDER BY p.period_number) FROM periods p),'[]'::jsonb) AS periods,
    coalesce((SELECT jsonb_agg(jsonb_build_object('accountId',a.id,'lineId',a.line_id,'code',a.code,'nameFr',a.name_fr,'nameEn',a.name_en,'type',a.type,'isActive',a.is_active,'annualCents',a.annual::text,'months',
      (SELECT jsonb_agg(jsonb_build_object('periodId',p.id,'targetCents',m.amount_cents::text,'actualCents',coalesce(x.cents,'0'),'hasActivity',coalesce(x.activity,0)>0) ORDER BY p.period_number)
       FROM periods p LEFT JOIN budget_monthly_target m ON m.company_id=a.company_id AND m.budget_line_id=a.line_id AND m.fiscal_period_id=p.id LEFT JOIN actual x ON x.account_id=a.id AND x.period_id=p.id)) ORDER BY a.code) FROM candidates a),'[]'::jsonb) AS accounts FROM chosen c`;
  if(!r)throw new AppError("budgets.notFound");if(r.periods.length!==12)throw new AppError("budgets.monthlyPeriods");if(r.accounts.length>MAX_BUDGET_ACCOUNTS)throw new AppError("budgets.tooMany");
  return {...r.budget,periods:r.periods,accounts:r.accounts.map(a=>({...a,annualCents:a.annualCents===null?null:BigInt(a.annualCents),months:a.months.map(m=>({...m,targetCents:m.targetCents===null?null:BigInt(m.targetCents),actualCents:BigInt(m.actualCents)}))}))};
 });
}
export async function getMonthlyAllocation(actor:CompanyContext,id:string,accountId:string){
 const p=await plan(actor,id,accountId),a=p.accounts.find(a=>a.accountId===accountId);
 if(!a||a.annualCents===null||!a.lineId)throw new AppError("budgets.account");
 return {budget:{id:p.id,name:p.name,revision:p.revision,from:p.from,to:p.to},account:{...a,annualCents:a.annualCents,lineId:a.lineId},periods:p.periods};
}
export async function saveMonthlyAllocation(actor:CompanyContext,id:string,accountId:string,input:z.input<typeof monthlyAllocationInput>){
 const parsed=monthlyAllocationInput.safeParse(input);if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(accountId).success||!parsed.success)throw new AppError("budgets.monthlyInvalid");
 const data=parsed.data;
 return withCompany(actor,async tx=>{
  await requireRole(tx,"budget.manage");
  const [b]=await tx.$queryRaw<{revision:number;fiscal_year_id:string}[]>`SELECT revision,fiscal_year_id FROM budget WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
  if(!b)throw new AppError("budgets.notFound");if(b.revision!==data.revision)throw new AppError("budgets.stale");
  const line=await tx.budgetLine.findFirst({where:{companyId:actor.companyId,budgetId:id,accountId},select:{id:true,amountCents:true}});if(!line)throw new AppError("budgets.account");
  const periods=await tx.fiscalPeriod.findMany({where:{companyId:actor.companyId,fiscalYearId:b.fiscal_year_id},select:{id:true}});
  if(periods.length!==12||data.targets.some(t=>!periods.some(p=>p.id===t.periodId)))throw new AppError("budgets.monthlyInvalid");
  const summary=allocationSummary(line.amountCents,data.targets.map(t=>t.amountCents));if(summary.remainingCents<0n)throw new AppError("budgets.monthlyExcess");
  // Replace inside one transaction so a redistribution cannot temporarily exceed the annual cap.
  await tx.budgetMonthlyTarget.deleteMany({where:{companyId:actor.companyId,budgetLineId:line.id}});
  const defined=data.targets.filter(t=>t.amountCents!==null);
  if(defined.length)await tx.budgetMonthlyTarget.createMany({data:defined.map(t=>({companyId:actor.companyId,budgetLineId:line.id,fiscalPeriodId:t.periodId,amountCents:t.amountCents!}))});
  await recordEvent(tx,{action:"budget.allocate_months",entityType:"budget",entityId:id,data:{accountId,definedMonths:defined.length,allocatedCents:summary.allocatedCents.toString(),annualCents:line.amountCents.toString()}});
 });
}
export async function getMonthlyBudget(actor:CompanyContext,id:string,periodId?:string){
 const p=await plan(actor,id);const today=todayIso();const selected=periodId?p.periods.find(v=>v.id===periodId):p.periods.find(v=>v.from<=today&&v.to>=today)??p.periods[0];
 if(!selected)throw new AppError("budgets.monthlyPeriod");
 const rows=p.accounts.map(a=>{
  const m=a.months.find(m=>m.periodId===selected.id)!;
  return {accountId:a.accountId,code:a.code,nameFr:a.nameFr,nameEn:a.nameEn,type:a.type,isActive:a.isActive,annualCents:a.annualCents,targetCents:m.targetCents,actualCents:m.actualCents,hasActivity:m.hasActivity,differenceCents:m.targetCents===null?null:m.actualCents-m.targetCents,allocation:a.annualCents===null?null:allocationSummary(a.annualCents,a.months.map(m=>m.targetCents))};
 }).filter(a=>a.annualCents!==null||a.hasActivity);
 const total=(type:"REVENUE"|"EXPENSE")=>rows.filter(r=>r.type===type).reduce((s,r)=>({targetCents:s.targetCents+(r.targetCents??0n),actualCents:s.actualCents+r.actualCents,unbudgeted:s.unbudgeted+(r.targetCents===null&&r.hasActivity?1:0)}),{targetCents:0n,actualCents:0n,unbudgeted:0});
 return {id:p.id,name:p.name,revision:p.revision,from:p.from,to:p.to,periods:p.periods,selected,rows,revenue:total("REVENUE"),expenses:total("EXPENSE")};
}
export type MonthlyBudget=Awaited<ReturnType<typeof getMonthlyBudget>>;
