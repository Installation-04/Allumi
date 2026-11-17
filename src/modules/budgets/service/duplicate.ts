import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { recordEvent } from "@/modules/audit";
import { requireRole } from "@/modules/companies";
import { AppError, isConflict } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { budgetInput, MAX_BUDGET_ACCOUNTS } from "../domain/budget";

const uuid = z.uuid();
const copyInput = budgetInput.extend({
  sourceRevision: z.number().int().positive().max(2147483647),
  stateToken: z.string().regex(/^[a-f0-9]{64}$/),
  skipInactive: z.boolean(),
});
type Target = {
  accountId: string; code: string; nameFr: string; nameEn: string;
  type: "REVENUE" | "EXPENSE"; isActive: boolean; amountCents: bigint;
};
function token(rows: readonly Target[]): string {
  // Account identity, labels and eligibility belong to the reviewed snapshot, as do the exact targets.
  return createHash("sha256").update(JSON.stringify(rows.map(r => [r.accountId,r.code,r.nameFr,r.nameEn,r.type,r.isActive,r.amountCents.toString()]))).digest("hex");
}
function preview(source: {id:string;name:string;revision:number;from:string;to:string}, rows: Target[]) {
  if(rows.length>MAX_BUDGET_ACCOUNTS) throw new AppError("budgets.tooMany");
  const summary=(active:boolean,type:Target["type"])=>rows.filter(r=>r.isActive===active&&r.type===type).reduce((sum,r)=>sum+r.amountCents,0n);
  return { source, targets:rows, stateToken:token(rows), activeCount:rows.filter(r=>r.isActive).length,
    inactiveCount:rows.filter(r=>!r.isActive).length,
    activeRevenueCents:summary(true,"REVENUE"),activeExpenseCents:summary(true,"EXPENSE"),
    inactiveRevenueCents:summary(false,"REVENUE"),inactiveExpenseCents:summary(false,"EXPENSE") };
}
/** A single SQL snapshot; no writes or account locks are taken while displaying the preview. */
export async function getBudgetCopyPreview(actor:CompanyContext, sourceId:string) {
  if(!uuid.safeParse(sourceId).success) throw new AppError("budgets.notFound");
  return withCompany(actor,async tx=>{
    await requireRole(tx,"budget.manage");
    const [r]=await tx.$queryRaw<{source:{id:string;name:string;revision:number;from:string;to:string};targets:(Omit<Target,"amountCents">&{amountCents:string})[]}[]>`
      SELECT jsonb_build_object('id',b.id,'name',b.name,'revision',b.revision,'from',to_char(f.start_date,'YYYY-MM-DD'),'to',to_char(f.end_date,'YYYY-MM-DD')) AS source,
      coalesce((SELECT jsonb_agg(r ORDER BY r."accountId") FROM (
        SELECT a.id AS "accountId",a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.type,a.is_active AS "isActive",l.amount_cents::text AS "amountCents"
        FROM budget_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
        WHERE l.company_id=b.company_id AND l.budget_id=b.id
        ORDER BY a.id LIMIT ${MAX_BUDGET_ACCOUNTS+1}
      ) r),'[]'::jsonb) AS targets
      FROM budget b JOIN fiscal_year f ON f.company_id=b.company_id AND f.id=b.fiscal_year_id
      WHERE b.company_id=${actor.companyId}::uuid AND b.id=${sourceId}::uuid`;
    if(!r) throw new AppError("budgets.notFound");
    return preview(r.source,r.targets.map(t=>({...t,amountCents:BigInt(t.amountCents)})));
  });
}
export type BudgetCopyPreview=Awaited<ReturnType<typeof getBudgetCopyPreview>>;
/** All source checks and destination writes share one transaction; an error leaves no partial scenario. */
export async function duplicateBudget(actor:CompanyContext,sourceId:string,input:z.input<typeof copyInput>):Promise<string> {
  const parsed=copyInput.safeParse(input);
  if(!uuid.safeParse(sourceId).success||!parsed.success) throw new AppError("budgets.invalid");
  const data=parsed.data;
  try {
    return await withCompany(actor,async tx=>{
      await requireRole(tx,"budget.manage");
      const [source]=await tx.$queryRaw<{revision:number}[]>`SELECT revision FROM budget WHERE company_id=${actor.companyId}::uuid AND id=${sourceId}::uuid FOR UPDATE`;
      if(!source) throw new AppError("budgets.notFound");
      if(source.revision!==data.sourceRevision) throw new AppError("budgets.copyStale");
      // Holding the source parent prevents committed target changes; account row locks freeze eligibility/labels.
      const rows=await tx.$queryRaw<Target[]>`
        SELECT a.id AS "accountId",a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.type,a.is_active AS "isActive",l.amount_cents AS "amountCents"
        FROM budget_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
        WHERE l.company_id=${actor.companyId}::uuid AND l.budget_id=${sourceId}::uuid
        ORDER BY a.id LIMIT ${MAX_BUDGET_ACCOUNTS+1} FOR SHARE OF a`;
      if(rows.length>MAX_BUDGET_ACCOUNTS) throw new AppError("budgets.tooMany");
      if(token(rows)!==data.stateToken) throw new AppError("budgets.copyStale");
      if(rows.some(r=>!r.isActive)&&!data.skipInactive) throw new AppError("budgets.copyInactive");
      if(!await tx.fiscalYear.findFirst({where:{companyId:actor.companyId,id:data.fiscalYearId},select:{id:true}})) throw new AppError("budgets.year");
      const destination=await tx.budget.create({data:{companyId:actor.companyId,fiscalYearId:data.fiscalYearId,name:data.name},select:{id:true}});
      const active=rows.filter(r=>r.isActive);
      if(active.length) await tx.budgetLine.createMany({data:active.map(r=>({companyId:actor.companyId,budgetId:destination.id,accountId:r.accountId,amountCents:r.amountCents}))});
      await recordEvent(tx,{action:"budget.duplicate",entityType:"budget",entityId:destination.id,data:{
        sourceBudgetId:sourceId,sourceRevision:source.revision,copiedTargetCount:active.length,
        excludedAccountIds:rows.filter(r=>!r.isActive).map(r=>r.accountId),
      }});
      return destination.id;
    });
  } catch(e) { if(isConflict(e)) throw new AppError("budgets.duplicate"); throw e; }
}
