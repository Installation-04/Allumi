import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { saveDraft,getDraft,postBill,getBill,saveCreditDraft,getCreditDraft,postCreditNote,getPostedCredit,getBillOpenCents,listPostedCredits,voidBill,deleteCreditDraft } from "@/modules/purchases";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
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
it("posts and fully applies exactly once, freezes the original identities and exposes read-only history",async()=>{
 const source=await invoice();const {draft}=await credit(source);
 await expect(postCreditNote(reader,draft.id,draft.revision,"2026-07-01")).rejects.toThrow();
 await expect(postCreditNote({userId:W.userOwnerB,companyId:W.companyB},draft.id,draft.revision,"2026-07-01")).rejects.toThrow();
 expect(await Promise.all([1,2].map(()=>postCreditNote(actor,draft.id,draft.revision,"2026-07-01")))).toEqual([draft.id,draft.id]);
 const posted=(await getPostedCredit(reader,draft.id))!;
 expect(posted).toMatchObject({number:"A-00002",status:"POSTED",totalCents:2874n,supplierSnapshot:source.supplierSnapshot});
 expect(posted.creditsApplied).toHaveLength(1);expect(posted.creditsApplied[0]?.amountCents).toBe(2874n);
 expect(await getBillOpenCents(reader,source.id)).toBe(8624n);
 expect((await listPostedCredits(reader,source.id)).map(c=>c.id)).toContain(draft.id);
 const lines=(await db.query("SELECT account_id,debit_cents::text,credit_cents::text,tax_box FROM journal_line WHERE entry_id=$1 ORDER BY line_no",[posted.journalEntryId])).rows;
 expect(lines).toEqual([{account_id:W.payable,debit_cents:"2874",credit_cents:"0",tax_box:null},{account_id:W.expenses,debit_cents:"0",credit_cents:"2500",tax_box:null},...[ [W.gstReceivable,"125"],[W.qstReceivable,"249"] ].map(([account_id,credit_cents])=>({account_id,debit_cents:"0",credit_cents,tax_box:"RECOVERABLE"}))]);
 expect(await getCreditDraft(actor,draft.id)).toBeNull();await expect(deleteCreditDraft(actor,draft.id,draft.revision)).rejects.toThrow();
 await expect(voidBill(actor,source.id,"2026-07-02","Correction")).rejects.toThrow();
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE source_id=$1",[draft.id])).rows[0].n).toBe(1);
});
it("serializes competing credits against one invoice, rejecting excess without consuming a number",async()=>{
 const source=await invoice();const first=await credit(source,"60"),second=await credit(source,"60");
 const results=await Promise.allSettled([first,second].map(c=>postCreditNote(actor,c.draft.id,c.draft.revision,"2026-07-01")));
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 expect(await getBillOpenCents(actor,source.id)).toBe(4599n);
 expect((await listPostedCredits(actor,source.id))).toHaveLength(1);
 const remaining=await credit(source,"40");await postCreditNote(actor,remaining.draft.id,remaining.draft.revision,"2026-07-01");
 expect(await getBillOpenCents(actor,source.id)).toBe(0n);
});
it("refuses stale reviews and invalid dates without posting",async()=>{
 const source=await invoice();const {draft,input}=await credit(source);
 await saveCreditDraft(actor,source.id,{...input,revision:draft.revision,memo:"Changed"},draft.id);
 await expect(postCreditNote(actor,draft.id,draft.revision,"2026-07-01")).rejects.toThrow();
 const current=(await getCreditDraft(actor,draft.id))!;
 await expect(postCreditNote(actor,draft.id,current.revision,"2026-06-01")).rejects.toThrow();
 await expect(postCreditNote(actor,draft.id,current.revision,"bad")).rejects.toThrow();
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=7",[W.companyA,W.userOwnerA]);
 const sequence=(await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='PURCHASE_DOCUMENT'",[W.companyA])).rows;
 await expect(postCreditNote(actor,draft.id,current.revision,"2026-07-01")).rejects.toThrow();
 expect((await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='PURCHASE_DOCUMENT'",[W.companyA])).rows).toEqual(sequence);
 expect(await getCreditDraft(actor,draft.id)).not.toBeNull();
 await postCreditNote(actor,draft.id,current.revision,"2026-08-01");
});

it("refuses full application when another credit has already used the remaining balance",async()=>{
 const target=await invoice(),other=await invoice();const external=await credit(other,"60");
 await postCreditNote(actor,external.draft.id,external.draft.revision,"2026-08-01");
 const posted=(await getPostedCredit(actor,external.draft.id))!;
 await withCompany(actor,async tx=>{
  await tx.purchaseCreditApplication.update({where:{id:posted.creditsApplied[0]!.id,companyId:actor.companyId},data:{unappliedDate:new Date("2026-08-02"),unappliedById:actor.userId}});
  await tx.purchaseCreditApplication.create({data:{companyId:actor.companyId,supplierCreditId:posted.id,billId:target.id,amountCents:posted.totalCents,appliedDate:new Date("2026-08-02"),createdById:actor.userId}});
 });
 const own=await credit(target,"50");
 await expect(postCreditNote(actor,own.draft.id,own.draft.revision,"2026-08-03")).rejects.toThrow("purchases.creditBalance");
 expect(await getCreditDraft(actor,own.draft.id)).not.toBeNull();
 expect(await getBillOpenCents(actor,target.id)).toBe(4599n);
});

it("database rejects a balanced forged credit entry that bypasses the posting service", async () => {
 const source=await invoice(); const {draft}=await credit(source);
 const { createPurchaseEntry }=await import("@/modules/ledger");
 await expect(withCompany(actor,async tx=>{
  const entry=await createPurchaseEntry(tx,actor,{documentId:draft.id,date:"2026-09-01",memo:"Forged credit",lines:[{accountId:W.payable,debitCents:draft.totalCents,creditCents:0n,contactId:W.supplier},{accountId:W.bank,debitCents:0n,creditCents:draft.totalCents}]});
  await tx.$executeRaw`UPDATE purchase_document SET status='POSTED',number='FORGED',posting_date='2026-09-01',journal_entry_id=${entry.id}::uuid,posted_at=now(),posted_by_id=${actor.userId}::uuid,supplier_snapshot='{"name":"Supplier"}'::jsonb WHERE company_id=${actor.companyId}::uuid AND id=${draft.id}::uuid`;
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
 })).rejects.toThrow();
 expect((await getCreditDraft(actor,draft.id))?.status).toBe("DRAFT");
});
