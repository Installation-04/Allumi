import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError, isConflict } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { budgetInput, targetInput, compareBudget, MAX_BUDGET_ACCOUNTS, type BudgetAccount } from "../domain/budget";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const select = { id: true, name: true, revision: true, fiscalYear: { select: { id: true, startDate: true, endDate: true } } } as const;
function dto(r: {id: string; name: string; revision: number; fiscalYear: {id:string;startDate:Date;endDate:Date}}) {
  return { id: r.id, name: r.name, revision: r.revision, fiscalYearId: r.fiscalYear.id, from: r.fiscalYear.startDate.toISOString().slice(0,10), to: r.fiscalYear.endDate.toISOString().slice(0,10) };
}
export async function listBudgets(actor: CompanyContext) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    return (await tx.budget.findMany({where: {companyId:actor.companyId}, select, orderBy:[{fiscalYear:{startDate:"desc"}},{name:"asc"}]})).map(dto);
  });
}
export async function createBudget(actor: CompanyContext, input: {name:string;fiscalYearId:string}) {
  const parsed = budgetInput.safeParse(input);
  if (!parsed.success) throw new AppError("budgets.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx,"budget.manage");
    if (!await tx.fiscalYear.findFirst({where:{companyId:actor.companyId,id:parsed.data.fiscalYearId},select:{id:true}})) throw new AppError("budgets.year");
    try { return (await tx.budget.create({data:{companyId:actor.companyId,...parsed.data}, select:{id:true}})).id; }
    catch(e) { if(isConflict(e)) throw new AppError("budgets.duplicate"); throw e; }
  });
}
async function lockBudget(tx: Tx, actor: CompanyContext, id:string, revision:number) {
  if (!UUID.test(id) || !Number.isSafeInteger(revision) || revision < 1 || revision >= 2147483647) throw new AppError("budgets.invalid");
  const [r] = await tx.$queryRaw<{revision:number}[]>`SELECT revision FROM budget WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
  if (!r) throw new AppError("budgets.notFound");
  if (r.revision !== revision) throw new AppError("budgets.stale");
}
export async function saveBudgetTarget(actor:CompanyContext,id:string,input:{accountId:string;amountCents:bigint;revision:number}) {
  const parsed=targetInput.safeParse(input);
  if(!parsed.success) throw new AppError("budgets.invalid");
  return withCompany(actor,async tx=>{
    await requireRole(tx,"budget.manage");
    await lockBudget(tx,actor,id,input.revision);
    const account=await tx.account.findFirst({where:{companyId:actor.companyId,id:input.accountId,type:{in:["REVENUE","EXPENSE"]}},select:{id:true,isActive:true}});
    const old=await tx.budgetLine.findFirst({where:{companyId:actor.companyId,budgetId:id,accountId:input.accountId},select:{id:true}});
    if(!account || (!old && !account.isActive)) throw new AppError("budgets.account");
    if(!old && await tx.budgetLine.count({where:{companyId:actor.companyId,budgetId:id}})>=MAX_BUDGET_ACCOUNTS) throw new AppError("budgets.tooMany");
    // The database advances the parent revision on every line change, including direct SQL writes.
    if(old) await tx.budgetLine.update({where:{id:old.id},data:{amountCents:input.amountCents}});
    else await tx.budgetLine.create({data:{companyId:actor.companyId,budgetId:id,accountId:input.accountId,amountCents:input.amountCents}});
  });
}
export async function removeBudgetTarget(actor:CompanyContext,id:string,accountId:string,revision:number) {
  if(!UUID.test(accountId)) throw new AppError("budgets.invalid");
  return withCompany(actor,async tx=>{
    await requireRole(tx,"budget.manage"); await lockBudget(tx,actor,id,revision);
    const result=await tx.budgetLine.deleteMany({where:{companyId:actor.companyId,budgetId:id,accountId}});
    if(result.count!==1) throw new AppError("budgets.account");
  });
}
export async function getBudgetComparison(actor:CompanyContext,id:string) {
  if(!UUID.test(id)) throw new AppError("budgets.notFound");
  return withCompany(actor,async tx=>{
    await requireRole(tx,"ledger.read");
    // One statement snapshot keeps the displayed revision, targets and actuals consistent while another user edits.
    const result=await tx.$queryRaw<{budget: {id:string;name:string;revision:number;fiscalYearId:string;from:string;to:string}; accounts: (Omit<BudgetAccount,"targetCents"|"actualCents"> & {targetCents:string|null;actualCents:string})[]}[]>`
      SELECT jsonb_build_object('id',b.id,'name',b.name,'revision',b.revision,'fiscalYearId',f.id,'from',to_char(f.start_date,'YYYY-MM-DD'),'to',to_char(f.end_date,'YYYY-MM-DD')) AS budget,
      coalesce((SELECT jsonb_agg(r ORDER BY r.code) FROM (
        SELECT a.id AS "accountId",a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.type,a.is_active AS "isActive",
          bl.amount_cents::text AS "targetCents",
          (CASE WHEN a.type='REVENUE' THEN coalesce(sum(l.credit_cents-l.debit_cents),0) ELSE coalesce(sum(l.debit_cents-l.credit_cents),0) END)::text AS "actualCents",
          count(l.id)>0 AS "hasActivity"
        FROM account a
        LEFT JOIN budget_line bl ON bl.company_id=a.company_id AND bl.account_id=a.id AND bl.budget_id=b.id
        LEFT JOIN journal_line l ON l.company_id=a.company_id AND l.account_id=a.id AND l.entry_date BETWEEN f.start_date AND f.end_date
        WHERE a.company_id=b.company_id AND a.type IN ('REVENUE','EXPENSE')
        GROUP BY a.id,bl.amount_cents HAVING bl.amount_cents IS NOT NULL OR count(l.id)>0
        ORDER BY a.code LIMIT ${MAX_BUDGET_ACCOUNTS+1}
      ) r),'[]'::jsonb) AS accounts
      FROM budget b JOIN fiscal_year f ON f.company_id=b.company_id AND f.id=b.fiscal_year_id
      WHERE b.company_id=${actor.companyId}::uuid AND b.id=${id}::uuid`;
    const r=result[0];if(!r) throw new AppError("budgets.notFound");
    if(r.accounts.length>MAX_BUDGET_ACCOUNTS) throw new AppError("budgets.tooMany");
    return {...r.budget,...compareBudget(r.accounts.map(a=>({...a,targetCents:a.targetCents===null?null:BigInt(a.targetCents),actualCents:BigInt(a.actualCents)})))};
  });
}
export type BudgetComparison = Awaited<ReturnType<typeof getBudgetComparison>>;
