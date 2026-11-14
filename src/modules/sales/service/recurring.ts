import "server-only";
import { requireRole } from "@/modules/companies";
import { todayIso, isValidIsoDate } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { recurringSchema, recurringDate, recurringDueDate } from "../domain/recurring";
import { prepareSalesDraft, saveDraftWithin } from "./drafts";
const iso=(date:Date)=>date.toISOString().slice(0,10);
async function run<T>(actor:CompanyContext,write:boolean,fn:(tx:Tx)=>Promise<T>) {
 try{return await withCompany(actor,async tx=>{await requireRole(tx,write?"sales.manage":"sales.read");return fn(tx);});}catch(error){throw toAppError(error);}
}
async function references(tx:Tx,items:boolean) {
 for(const action of ["contact.read","ledger.read","taxes.read"] as const)await requireRole(tx,action);
 if(items)await requireRole(tx,"catalog.read");
}
async function source(tx:Tx,actor:CompanyContext,id:string) {
 await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR SHARE`;
 const row=await tx.salesDocument.findFirst({where:{companyId:actor.companyId,id,kind:"INVOICE",status:"POSTED"},include:{lines:{orderBy:{position:"asc"}}}});
 if(!row)throw new AppError("recurring.source");return row;
}
function copiedLines(lines:{itemId:string|null;description:string;quantity:{toString():string};unitPrice:{toString():string};accountId:string;taxCodeId:string|null}[]) {
 return lines.map(l=>({itemId:l.itemId??"",description:l.description,quantity:l.quantity.toString(),unitPrice:l.unitPrice.toString(),accountId:l.accountId,taxCodeId:l.taxCodeId??""}));
}
async function revision(tx:Tx,actor:CompanyContext,id:string,write=false) {
 const rows=write?await tx.$queryRaw<{revision:string}[]>`SELECT updated_at::text AS revision FROM sales_recurring_plan WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`:await tx.$queryRaw<{revision:string}[]>`SELECT updated_at::text AS revision FROM sales_recurring_plan WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid`;
 return rows[0]?.revision??null;
}
export async function recurringSources(actor:CompanyContext) {
 return run(actor,false,async tx=>{
  const rows=await tx.salesDocument.findMany({where:{companyId:actor.companyId,kind:"INVOICE",status:"POSTED"},select:{id:true,number:true,issueDate:true},orderBy:[{postedAt:"desc"},{id:"desc"}],take:101});
  return {sources:rows.slice(0,100).map(r=>({...r,issueDate:iso(r.issueDate)})),truncated:rows.length>100};
 });
}
export async function createRecurringPlan(actor:CompanyContext,input:unknown) {
 const parsed=recurringSchema.safeParse(input);if(!parsed.success)throw new AppError("recurring.invalid");const data=parsed.data;
 return run(actor,true,async tx=>{
  const values={companyId:actor.companyId,sourceInvoiceId:data.sourceInvoiceId,creationKey:data.creationKey,name:data.name,startDate:new Date(`${data.startDate}T00:00:00Z`),endDate:data.endDate?new Date(`${data.endDate}T00:00:00Z`):null,intervalMonths:data.intervalMonths,anchorDay:data.anchorDay,termDays:data.termDays,createdById:actor.userId};
  const matches=(p:{sourceInvoiceId:string;name:string;startDate:Date;endDate:Date|null;intervalMonths:number;anchorDay:number;termDays:number})=>p.sourceInvoiceId===data.sourceInvoiceId&&p.name===data.name&&iso(p.startDate)===data.startDate&&(p.endDate?iso(p.endDate):"")===data.endDate&&p.intervalMonths===data.intervalMonths&&p.anchorDay===data.anchorDay&&p.termDays===data.termDays;
  const previous=await tx.salesRecurringPlan.findFirst({where:{companyId:actor.companyId,creationKey:data.creationKey}});
  if(previous){if(!matches(previous))throw new AppError("recurring.stale");return previous.id;}
  const invoice=await source(tx,actor,data.sourceInvoiceId);if(data.startDate<=iso(invoice.issueDate))throw new AppError("recurring.invalid");
  await references(tx,invoice.lines.some(l=>l.itemId!==null));const dueDate=recurringDueDate(data.startDate,data.termDays);if(!dueDate)throw new AppError("recurring.invalid");
  await prepareSalesDraft(tx,actor,{contactId:invoice.contactId,issueDate:data.startDate,dueDate,reference:invoice.reference??invoice.number??"",memo:invoice.memo??"",revision:"",lines:copiedLines(invoice.lines)},invoice.taxRounding);
  await tx.salesRecurringPlan.createMany({data:[values],skipDuplicates:true});
  const plan=await tx.salesRecurringPlan.findFirstOrThrow({where:{companyId:actor.companyId,creationKey:data.creationKey}});if(!matches(plan))throw new AppError("recurring.stale");return plan.id;
 });
}
export async function getRecurringPlan(actor:CompanyContext,id:string) {
 return run(actor,false,async tx=>{
  for(let attempt=0;attempt<3;attempt++) {
   const token=await revision(tx,actor,id);if(!token)return null;
   const plan=await tx.salesRecurringPlan.findFirst({where:{companyId:actor.companyId,id},include:{sourceInvoice:{select:{id:true,number:true,status:true,billingSnapshot:true,issueDate:true}},occurrences:{orderBy:{occurrenceIndex:"desc"},take:51,include:{invoice:{select:{status:true,number:true,totalCents:true}}}}}});if(!plan)return null;
   if(await revision(tx,actor,id)!==token)continue;
   const next=recurringDate(iso(plan.startDate),plan.intervalMonths,plan.nextIndex,plan.anchorDay);
   const nextDate=next&&(!plan.endDate||next<=iso(plan.endDate))&&recurringDueDate(next,plan.termDays)?next:null;
   const snap=plan.sourceInvoice.billingSnapshot as {name?:unknown}|null;
   return {id:plan.id,name:plan.name,status:plan.status as "ACTIVE"|"PAUSED"|"CANCELLED",revision:token,startDate:iso(plan.startDate),endDate:plan.endDate?iso(plan.endDate):null,intervalMonths:plan.intervalMonths,anchorDay:plan.anchorDay,termDays:plan.termDays,nextDate,finished:nextDate===null,due:plan.status==="ACTIVE"&&nextDate!==null&&nextDate<=todayIso(),sourceInvoice:plan.sourceInvoice,customer:typeof snap?.name==="string"?snap.name:null,historyTruncated:plan.occurrences.length>50,occurrences:plan.occurrences.slice(0,50).map(o=>({id:o.id,date:iso(o.scheduledDate),status:o.status,invoiceId:o.invoiceId,invoice:o.invoice}))};
  }
  throw new AppError("recurring.stale");
 });
}
export async function listRecurringPlans(actor:CompanyContext,options:{q?:string;page?:number;dueOnly?:boolean}={}) {
 const q=(options.q??"").trim(),page=options.page??1;if(q.length>120||/[\u0000-\u001f\u007f]/.test(q)||!Number.isInteger(page)||page<1||page>1000)throw new AppError("recurring.invalid");
 return run(actor,false,async tx=>{
  const pattern=`%${q.replace(/[\\%_]/g,"\\$&")}%`;
  const rows=await tx.$queryRaw<{id:string;name:string;status:"ACTIVE"|"PAUSED"|"CANCELLED";nextDate:Date|null;customer:string|null;sourceNumber:string|null}[]>`
   SELECT p.id,p.name,p.status,CASE WHEN p.end_date IS NULL OR sales_recurring_date(p.start_date,p.interval_months,p.next_index,p.anchor_day)<=p.end_date THEN sales_recurring_date(p.start_date,p.interval_months,p.next_index,p.anchor_day) END AS "nextDate",s.billing_snapshot->>'name' AS customer,s.number AS "sourceNumber"
   FROM sales_recurring_plan p JOIN sales_document s ON s.company_id=p.company_id AND s.id=p.source_invoice_id
   WHERE p.company_id=${actor.companyId}::uuid AND (${q}='' OR p.name ILIKE ${pattern} OR s.number ILIKE ${pattern} OR s.billing_snapshot->>'name' ILIKE ${pattern})
    AND (NOT ${options.dueOnly??false} OR p.status='ACTIVE' AND sales_recurring_date(p.start_date,p.interval_months,p.next_index,p.anchor_day)<=(now() AT TIME ZONE 'America/Toronto')::date AND(p.end_date IS NULL OR sales_recurring_date(p.start_date,p.interval_months,p.next_index,p.anchor_day)<=p.end_date))
   ORDER BY p.created_at DESC,p.id DESC LIMIT 51 OFFSET ${(page-1)*50}`;
  return {page,hasMore:rows.length>50,plans:rows.slice(0,50).map(r=>({...r,nextDate:r.nextDate?iso(r.nextDate):null}))};
 });
}
export async function changeRecurringStatus(actor:CompanyContext,id:string,reviewed:string,status:"ACTIVE"|"PAUSED"|"CANCELLED") {
 if(!["ACTIVE","PAUSED","CANCELLED"].includes(status))throw new AppError("recurring.invalid");
 return run(actor,true,async tx=>{
  const token=await revision(tx,actor,id,true);if(!reviewed||token!==reviewed)throw new AppError("recurring.stale");
  const plan=await tx.salesRecurringPlan.findFirstOrThrow({where:{companyId:actor.companyId,id}});if(plan.status==="CANCELLED"||plan.status===status)throw new AppError("recurring.state");
  await tx.salesRecurringPlan.update({where:{companyId:actor.companyId,id},data:{status}});
 });
}
export async function generateRecurringDraft(actor:CompanyContext,id:string,reviewed:string,expectedDate:string) {
 if(!isValidIsoDate(expectedDate)||expectedDate>todayIso())throw new AppError("recurring.future");
 return run(actor,true,async tx=>{
  const token=await revision(tx,actor,id,true);if(!token)throw new AppError("recurring.stale");
  const previous=await tx.salesRecurringOccurrence.findFirst({where:{companyId:actor.companyId,planId:id,scheduledDate:new Date(`${expectedDate}T00:00:00Z`)}});
  if(previous){if(!previous.invoiceId)throw new AppError("recurring.deleted");return previous.invoiceId;}
  if(!reviewed||token!==reviewed)throw new AppError("recurring.stale");
  const plan=await tx.salesRecurringPlan.findFirstOrThrow({where:{companyId:actor.companyId,id}});
  const next=recurringDate(iso(plan.startDate),plan.intervalMonths,plan.nextIndex,plan.anchorDay),dueDate=next?recurringDueDate(next,plan.termDays):null;
  if(plan.status!=="ACTIVE"||next!==expectedDate||!dueDate||plan.endDate&&next>iso(plan.endDate))throw new AppError("recurring.state");
  const invoice=await source(tx,actor,plan.sourceInvoiceId);await references(tx,invoice.lines.some(l=>l.itemId!==null));
  const invoiceId=await saveDraftWithin(tx,actor,{contactId:invoice.contactId,issueDate:next,dueDate,reference:invoice.reference??invoice.number??"",memo:invoice.memo??"",lines:copiedLines(invoice.lines)},undefined,invoice.taxRounding);
  await tx.salesRecurringOccurrence.create({data:{companyId:actor.companyId,planId:id,occurrenceIndex:plan.nextIndex,scheduledDate:new Date(`${next}T00:00:00Z`),invoiceId,createdById:actor.userId}});
  await tx.salesRecurringPlan.update({where:{companyId:actor.companyId,id},data:{nextIndex:{increment:1}}});
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;return invoiceId;
 });
}
