import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import type pg from "pg";
import {saveDraft,getDraft,postInvoice,deleteDraft,saveDraft as editDraft,createRecurringPlan,getRecurringPlan,listRecurringPlans,changeRecurringStatus,generateRecurringDraft} from "@/modules/sales";
import {owner} from "./helpers";
import {seedWorld,W,appClient,inContext} from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader},other={userId:W.userOwnerB,companyId:W.companyB};
const invoiceInput={contactId:W.customer,issueDate:"2026-01-01",dueDate:"2026-01-31",reference:"Contrat",memo:"Note publique",lines:[{itemId:"",description:"Service",quantity:"1",unitPrice:"100",accountId:W.sales,taxCodeId:W.taxCodeStandard}]};
let db:pg.Client,app:pg.Client,sourceId:string;
const input=()=>({creationKey:randomUUID(),sourceInvoiceId:sourceId,name:"Abonnement",startDate:"2026-01-31",endDate:"2026-03-31",intervalMonths:1,anchorDay:31,termDays:30});
beforeAll(async()=>{db=await owner();await seedWorld(db);app=await appClient();await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5)",[W.companyA]);sourceId=await saveDraft(actor,invoiceInput);await postInvoice(actor,sourceId,(await getDraft(actor,sourceId))!.revision,"2026-01-01");});
afterAll(async()=>{await app?.end();await db?.end();});
it("creates plans idempotently without posting or numbering another invoice",async()=>{
 const before=(await db.query("SELECT count(*) AS n FROM journal_entry")).rows;const data=input();const ids=await Promise.all([createRecurringPlan(actor,data),createRecurringPlan(actor,data)]);expect(ids[0]).toBe(ids[1]);const p=(await getRecurringPlan(reader,ids[0]!))!;expect(p).toMatchObject({nextDate:"2026-01-31",status:"ACTIVE",anchorDay:31,customer:expect.any(String)});
 expect((await db.query("SELECT count(*) AS n FROM journal_entry")).rows).toEqual(before);
 await expect(createRecurringPlan(actor,{...data,name:"Changed"})).rejects.toThrow("recurring.stale");
 for(const a of [reader,other])await expect(createRecurringPlan(a,input())).rejects.toThrow();
 expect(await getRecurringPlan(other,p.id)).toBeNull();expect((await listRecurringPlans(other)).plans).toHaveLength(0);
});
it("generates once per scheduled date under concurrency, uses exact taxes and advances from the original anchor",async()=>{
 const id=await createRecurringPlan(actor,input());const p=(await getRecurringPlan(actor,id))!;
 const ids=await Promise.all([1,2].map(()=>generateRecurringDraft(actor,id,p.revision,p.nextDate!)));expect(ids[0]).toBe(ids[1]);const d=(await getDraft(actor,ids[0]!))!;expect(d).toMatchObject({issueDate:"2026-01-31",dueDate:"2026-03-02",totalCents:11498n,memo:"Note publique",recurringOccurrence:{planId:id,scheduledDate:"2026-01-31"}});
 expect((await getRecurringPlan(actor,id))).toMatchObject({nextDate:"2026-02-28"});await expect(generateRecurringDraft(actor,id,p.revision,"2026-02-28")).rejects.toThrow("recurring.stale");
 await expect(editDraft(actor,{...invoiceInput,contactId:W.otherCustomer,revision:d.revision},d.id)).rejects.toThrow("recurring.customerLocked");
 await expect(inContext(app,actor,()=>app.query("UPDATE sales_document SET contact_id=$2 WHERE id=$1",[d.id,W.otherCustomer]))).rejects.toMatchObject({code:"AL004"});
 await expect(inContext(app,actor,()=>app.query("UPDATE sales_recurring_occurrence SET invoice_id=NULL,status='DRAFT_DELETED' WHERE invoice_id=$1",[d.id]))).rejects.toMatchObject({code:"AL004"});
 await deleteDraft(actor,d.id,d.revision);const deleted=(await getRecurringPlan(actor,id))!;expect(deleted.occurrences[0]).toMatchObject({status:"DRAFT_DELETED",invoiceId:null});expect(deleted.nextDate).toBe("2026-02-28");await expect(generateRecurringDraft(actor,id,p.revision,"2026-01-31")).rejects.toThrow("recurring.deleted");
 for(const date of ["2026-02-28","2026-03-31"]){const current=(await getRecurringPlan(actor,id))!;await generateRecurringDraft(actor,id,current.revision,date);}
 expect((await getRecurringPlan(actor,id))).toMatchObject({nextDate:null,finished:true});
});
it("pauses, resumes and permanently cancels, refusing stale, future and unauthorized runs",async()=>{
 const id=await createRecurringPlan(actor,input());let p=(await getRecurringPlan(actor,id))!;
 await changeRecurringStatus(actor,id,p.revision,"PAUSED");await expect(generateRecurringDraft(actor,id,p.revision,p.nextDate!)).rejects.toThrow("recurring.stale");p=(await getRecurringPlan(actor,id))!;await expect(generateRecurringDraft(actor,id,p.revision,p.nextDate!)).rejects.toThrow("recurring.state");
 await changeRecurringStatus(actor,id,p.revision,"ACTIVE");p=(await getRecurringPlan(actor,id))!;
 for(const a of [reader,other])await expect(generateRecurringDraft(a,id,p.revision,p.nextDate!)).rejects.toThrow();
 await expect(generateRecurringDraft(actor,id,p.revision,"2999-01-01")).rejects.toThrow("recurring.future");
 await changeRecurringStatus(actor,id,p.revision,"CANCELLED");p=(await getRecurringPlan(actor,id))!;await expect(changeRecurringStatus(actor,id,p.revision,"ACTIVE")).rejects.toThrow("recurring.state");
 await expect(inContext(app,actor,()=>app.query("UPDATE sales_recurring_plan SET start_date='2026-02-28' WHERE id=$1",[id]))).rejects.toMatchObject({code:"AL006"});
 await expect(inContext(app,actor,()=>app.query("UPDATE sales_recurring_plan SET next_index=next_index+1 WHERE id=$1",[id]))).rejects.toThrow();
});
it("rechecks dated taxes, preserves source rounding and rolls back failures without advancing",async()=>{
 const id=await createRecurringPlan(actor,{...input(),startDate:"2026-02-28"});const p=(await getRecurringPlan(actor,id))!;
 await db.query("UPDATE company SET tax_rounding='PER_DOCUMENT' WHERE id=$1",[W.companyA]);await db.query("UPDATE tax_rate SET effective_to='2026-01-31' WHERE company_id=$1 AND tax_id=$2",[W.companyA,W.gst]);await db.query("INSERT INTO tax_rate(id,company_id,tax_id,effective_from,rate) VALUES(gen_random_uuid(),$1,$2,'2026-02-01',0.06)",[W.companyA,W.gst]);
 await db.query("UPDATE contact SET is_active=false WHERE id=$1",[W.customer]);await expect(generateRecurringDraft(actor,id,p.revision,p.nextDate!)).rejects.toThrow();expect((await getRecurringPlan(actor,id))?.nextDate).toBe(p.nextDate);await db.query("UPDATE contact SET is_active=true WHERE id=$1",[W.customer]);
 const draftId=await generateRecurringDraft(actor,id,p.revision,p.nextDate!);expect(await getDraft(actor,draftId)).toMatchObject({totalCents:11598n,taxRounding:"PER_LINE"});
 await db.query("UPDATE company SET tax_rounding='PER_LINE' WHERE id=$1",[W.companyA]);
});
it("keeps source snapshots and history visible with Sales read alone",async()=>{
 await db.query("UPDATE membership SET module_access='{\"contacts\":\"none\",\"taxes\":\"none\",\"accounting\":\"none\"}'::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 const plans=await listRecurringPlans(reader,{q:"Abonnement"});expect(plans.plans.length).toBeGreaterThan(0);expect((await getRecurringPlan(reader,plans.plans[0]!.id))?.customer).toBeTruthy();
 for(const q of ["%","_","\\"])expect((await listRecurringPlans(reader,{q})).plans).toHaveLength(0);
 await db.query("UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 const dates=(await db.query("SELECT sales_recurring_date('2024-02-29',12,4,29)::text AS d")).rows;expect(dates[0].d).toBe("2028-02-29");
});
it("uses the public source number instead of an internal schedule name when reference is absent",async()=>{
 const original=await saveDraft(actor,{...invoiceInput,reference:""});await postInvoice(actor,original,(await getDraft(actor,original))!.revision,"2026-01-01");
 const id=await createRecurringPlan(actor,{...input(),sourceInvoiceId:original,name:"INTERNAL_ONLY"});const plan=(await getRecurringPlan(actor,id))!;const draftId=await generateRecurringDraft(actor,id,plan.revision,plan.nextDate!);const draft=(await getDraft(actor,draftId))!;
 expect(draft.reference).toBe(plan.sourceInvoice.number);expect(draft.reference).not.toContain("INTERNAL");
});
it("requires the counter advance at commit even for an otherwise matching invoice",async()=>{
 const id=await createRecurringPlan(actor,input());const invoiceId=await saveDraft(actor,{...invoiceInput,issueDate:"2026-01-31",dueDate:"2026-03-02"});
 await expect(inContext(app,actor,()=>app.query("INSERT INTO sales_recurring_occurrence(id,company_id,plan_id,occurrence_index,scheduled_date,invoice_id,created_by_id,updated_at) VALUES(gen_random_uuid(),$1,$2,0,'2026-01-31',$3,$4,now())",[W.companyA,id,invoiceId,W.userOwnerA]))).rejects.toMatchObject({code:"AL004"});
 expect((await getRecurringPlan(actor,id))?.occurrences).toHaveLength(0);
});
