import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { saveDraft,getDraft,postBill,getBill,saveCreditDraft,getCreditDraft,postCreditNote,getPostedCredit,getBillOpenCents,voidBill,voidCreditNote } from "@/modules/purchases";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { randomUUID } from "node:crypto";
import { appClient, inContext, entry, line, seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
const reader={...actor,userId:W.userReader};
let db:pg.Client;
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5)",[W.companyA]);});
afterAll(async()=>{await db?.end();});
async function invoice(){
  const id=await saveDraft(actor,{contactId:W.supplier,documentDate:"2026-06-01",dueDate:"2026-07-01",lines:[{description:"Service",quantity:"1",unitPrice:"100",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});
  await postBill(actor,id,(await getDraft(actor,id))!.revision,"2026-06-01");return (await getBill(actor,id))!;
}
async function credit(source:Awaited<ReturnType<typeof invoice>>,amount="25"){
 const input={documentDate:"2026-07-01",memo:"Partial adjustment",lines:[{lineId:source.lines[0]!.id,amount}]};
 const id=await saveCreditDraft(actor,source.id,input);return {input,draft:(await getCreditDraft(actor,id))!};
}

async function postedCredit() {
 const source=await invoice();const {draft}=await credit(source);
 await postCreditNote(actor,draft.id,draft.revision,"2026-07-01");
 return {source,posted:(await getPostedCredit(actor,draft.id))!};
}
it("unapplies and exactly reverses once under concurrent retries, preserving history and restoring the invoice",async()=>{
 const {source,posted}=await postedCredit();
 await expect(voidCreditNote(reader,posted.id,"2026-07-02","Correction")).rejects.toThrow();
 await expect(voidCreditNote({userId:W.userOwnerB,companyId:W.companyB},posted.id,"2026-07-02","Correction")).rejects.toThrow();
 expect(await Promise.all([1,2].map(()=>voidCreditNote(actor,posted.id,"2026-07-02","Correction")))).toEqual([posted.id,posted.id]);
 const result=(await getPostedCredit(reader,posted.id))!;
 expect(result).toMatchObject({status:"VOID",number:posted.number,totalCents:posted.totalCents,journalEntryId:posted.journalEntryId,voidReason:"Correction",voidedById:actor.userId});
 expect(result.creditsApplied).toHaveLength(1);
 expect(result.creditsApplied[0]).toMatchObject({id:posted.creditsApplied[0]!.id,unappliedById:actor.userId,unappliedDate:new Date("2026-07-02")});
 expect(await getBillOpenCents(reader,source.id)).toBe(source.totalCents);
 const original=(await db.query("SELECT account_id,contact_id,tax_id,tax_box,debit_cents::text,credit_cents::text FROM journal_line WHERE entry_id=$1 ORDER BY line_no",[posted.journalEntryId])).rows;
 const reverse=(await db.query("SELECT account_id,contact_id,tax_id,tax_box,debit_cents::text,credit_cents::text FROM journal_line WHERE entry_id=$1 ORDER BY line_no",[result.voidEntryId])).rows;
 expect(reverse).toEqual(original.map(l=>({...l,debit_cents:l.credit_cents,credit_cents:l.debit_cents})));
 expect((await db.query("SELECT count(*)::int n FROM journal_entry WHERE reverses_entry_id=$1",[posted.journalEntryId])).rows[0].n).toBe(1);
 const audit=(await db.query("SELECT after->>'status' AS status FROM audit_log WHERE entity_id=$1 AND action='row.update'",[posted.id])).rows;
 expect(audit.map(r=>r.status)).toContain("VOID");
 const applicationAudit=(await db.query("SELECT after->>'unapplied_by_id' AS actor FROM audit_log WHERE entity_id=$1 AND action='row.update'",[posted.creditsApplied[0]!.id])).rows;
 expect(applicationAudit.map(r=>r.actor)).toContain(actor.userId);
 await voidBill(actor,source.id,"2026-07-03","Corrected source");
});
it("rolls back the unapplication and number when the reversal period is locked",async()=>{
 const {source,posted}=await postedCredit();
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=8",[W.companyA,W.userOwnerA]);
 const before=(await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='JOURNAL_ENTRY'",[actor.companyId])).rows;
 await expect(voidCreditNote(actor,posted.id,"2026-08-02","Locked")).rejects.toThrow();
 expect((await getPostedCredit(actor,posted.id))!.creditsApplied[0]!.unappliedDate).toBeNull();
 expect((await getPostedCredit(actor,posted.id))!.status).toBe("POSTED");
 expect(await getBillOpenCents(actor,source.id)).toBe(8624n);
 expect((await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='JOURNAL_ENTRY'",[actor.companyId])).rows).toEqual(before);
 await voidCreditNote(actor,posted.id,"2026-09-01","Open period");
});
it("rejects missing reasons, draft credits and dates before posting or historical unapplication",async()=>{
 const {source,posted}=await postedCredit();
 for(const [date,reason] of [["bad","Reason"],["2026-07-02"," "],["2026-07-02","x".repeat(501)],["2026-06-30","Reason"]]) await expect(voidCreditNote(actor,posted.id,date!,reason!)).rejects.toThrow();
 const draft=await credit(source);await expect(voidCreditNote(actor,draft.draft.id,"2026-07-02","Reason")).rejects.toThrow();
 await withCompany(actor,tx=>tx.purchaseCreditApplication.update({where:{id:posted.creditsApplied[0]!.id,companyId:actor.companyId},data:{unappliedDate:new Date("2026-07-10"),unappliedById:actor.userId}}));
 await expect(voidCreditNote(actor,posted.id,"2026-07-09","Too early")).rejects.toThrow("purchases.creditVoidDate");
 await voidCreditNote(actor,posted.id,"2026-07-10","Already unapplied");
 expect((await getPostedCredit(actor,posted.id))!.creditsApplied[0]!.unappliedDate).toEqual(new Date("2026-07-10"));
});
it("does not silently remove an application to another invoice",async()=>{
 const {posted}=await postedCredit();const target=await invoice();
 await withCompany(actor,async tx=>{
  await tx.purchaseCreditApplication.update({where:{id:posted.creditsApplied[0]!.id,companyId:actor.companyId},data:{unappliedDate:new Date("2026-07-02"),unappliedById:actor.userId}});
  await tx.purchaseCreditApplication.create({data:{companyId:actor.companyId,supplierCreditId:posted.id,billId:target.id,amountCents:posted.totalCents,appliedDate:new Date("2026-07-02"),createdById:actor.userId}});
 });
 await expect(voidCreditNote(actor,posted.id,"2026-07-03","Correction")).rejects.toThrow("purchases.creditVoidLinked");
 expect(await getBillOpenCents(actor,target.id)).toBe(8624n);
 expect((await getPostedCredit(actor,posted.id))!.status).toBe("POSTED");
});
it("allows a replacement credit after voiding and serializes a competing new posting",async()=>{
 const source=await invoice();const first=await credit(source,"60"),second=await credit(source,"60");
 await postCreditNote(actor,first.draft.id,first.draft.revision,"2026-07-01");
 await Promise.allSettled([voidCreditNote(actor,first.draft.id,"2026-07-02","Replace"),postCreditNote(actor,second.draft.id,second.draft.revision,"2026-07-02")]);
 expect((await getPostedCredit(actor,first.draft.id))!.status).toBe("VOID");
 await postCreditNote(actor,second.draft.id,second.draft.revision,"2026-07-02");
 expect(await getBillOpenCents(actor,source.id)).toBe(4599n);
});

it("refuses an active refund without altering the credit or allocation",async()=>{
 const {posted}=await postedCredit();
 const app=await appClient();const paymentId=randomUUID(),entryId=randomUUID();
 try {await inContext(app,actor,async()=>{
  await app.query("UPDATE purchase_credit_application SET unapplied_date='2026-07-02',unapplied_by_id=app_current_user_id() WHERE supplier_credit_id=$1",[posted.id]);
  await entry(app,{id:entryId,no:90001,date:"2026-07-02",source:"PAYMENT",sourceId:paymentId});
  await line(app,entryId,1,W.bank,{debit:2874});
  await line(app,entryId,2,W.payable,{credit:2874,contact:W.supplier});
  await app.query("INSERT INTO payment(id,company_id,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,updated_at) VALUES($1,app_tenant_id(),'RECEIVED','PAYABLE',$2,'2026-07-02',2874,$3,'EFT',$4,app_current_user_id(),now())",[paymentId,W.supplier,W.bank,entryId]);
  await app.query("INSERT INTO payment_allocation(id,company_id,payment_id,purchase_document_id,amount_cents,applied_date,created_by_id) VALUES(gen_random_uuid(),app_tenant_id(),$1,$2,2874,'2026-07-02',app_current_user_id())",[paymentId,posted.id]);
 },{commit:true});} finally {await app.end();}
 await expect(voidCreditNote(actor,posted.id,"2026-07-03","Refund exists")).rejects.toThrow("purchases.creditVoidLinked");
 expect((await getPostedCredit(actor,posted.id))!.status).toBe("POSTED");
 expect((await db.query("SELECT unapplied_date FROM payment_allocation WHERE payment_id=$1",[paymentId])).rows[0].unapplied_date).toBeNull();
});
