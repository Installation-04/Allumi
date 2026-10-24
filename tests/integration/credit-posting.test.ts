import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { saveDraft,getDraft,postInvoice,getInvoice,saveCreditDraft,getCreditDraft,postCreditNote,getPostedCredit,getInvoiceOpenCents,listPostedCredits,voidInvoice,deleteCreditDraft } from "@/modules/sales";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
const reader={...actor,userId:W.userReader};
let db:pg.Client;
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5)",[W.companyA]);});
afterAll(async()=>{await db?.end();});
async function invoice(){
  const id=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-01",dueDate:"2026-07-01",lines:[{description:"Service",quantity:"1",unitPrice:"100",accountId:W.sales,taxCodeId:W.taxCodeStandard}]});
  await postInvoice(actor,id,(await getDraft(actor,id))!.revision,"2026-06-01");return (await getInvoice(actor,id))!;
}
async function credit(source:Awaited<ReturnType<typeof invoice>>,amount="25"){
 const input={issueDate:"2026-07-01",memo:"Partial adjustment",lines:[{lineId:source.lines[0]!.id,amount}]};
 const id=await saveCreditDraft(actor,source.id,input);return {input,draft:(await getCreditDraft(actor,id))!};
}
it("posts and fully applies exactly once, freezes the original identities and exposes read-only history",async()=>{
 const source=await invoice();const {draft}=await credit(source);
 await expect(postCreditNote(reader,draft.id,draft.revision,"2026-07-01")).rejects.toThrow();
 await expect(postCreditNote({userId:W.userOwnerB,companyId:W.companyB},draft.id,draft.revision,"2026-07-01")).rejects.toThrow();
 expect(await Promise.all([1,2].map(()=>postCreditNote(actor,draft.id,draft.revision,"2026-07-01")))).toEqual([draft.id,draft.id]);
 const posted=(await getPostedCredit(reader,draft.id))!;
 expect(posted).toMatchObject({number:"AV-00001",status:"POSTED",totalCents:2874n,billingSnapshot:source.billingSnapshot,issuerSnapshot:source.issuerSnapshot});
 expect(posted.creditsApplied).toHaveLength(1);expect(posted.creditsApplied[0]?.amountCents).toBe(2874n);
 expect(await getInvoiceOpenCents(reader,source.id)).toBe(8624n);
 expect((await listPostedCredits(reader,source.id)).map(c=>c.id)).toContain(draft.id);
 const lines=(await db.query("SELECT account_id,debit_cents::text,credit_cents::text,tax_box FROM journal_line WHERE entry_id=$1 ORDER BY line_no",[posted.journalEntryId])).rows;
 expect(lines).toEqual([{account_id:W.receivable,debit_cents:"0",credit_cents:"2874",tax_box:null},{account_id:W.sales,debit_cents:"2500",credit_cents:"0",tax_box:null},...[ [W.gstPayable,"125"],[W.qstPayable,"249"] ].map(([account_id,debit_cents])=>({account_id,debit_cents,credit_cents:"0",tax_box:"COLLECTED"}))]);
 expect(await getCreditDraft(actor,draft.id)).toBeNull();await expect(deleteCreditDraft(actor,draft.id,draft.revision)).rejects.toThrow();
 await expect(voidInvoice(actor,source.id,"2026-07-02","Correction")).rejects.toThrow();
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE source_id=$1",[draft.id])).rows[0].n).toBe(1);
});
it("serializes competing credits against one invoice, rejecting excess without consuming a number",async()=>{
 const source=await invoice();const first=await credit(source,"60"),second=await credit(source,"60");
 const results=await Promise.allSettled([first,second].map(c=>postCreditNote(actor,c.draft.id,c.draft.revision,"2026-07-01")));
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 expect(await getInvoiceOpenCents(actor,source.id)).toBe(4599n);
 expect((await listPostedCredits(actor,source.id))).toHaveLength(1);
 const remaining=await credit(source,"40");await postCreditNote(actor,remaining.draft.id,remaining.draft.revision,"2026-07-01");
 expect(await getInvoiceOpenCents(actor,source.id)).toBe(0n);
});
it("refuses stale reviews and invalid dates without posting",async()=>{
 const source=await invoice();const {draft,input}=await credit(source);
 await saveCreditDraft(actor,source.id,{...input,revision:draft.revision,memo:"Changed"},draft.id);
 await expect(postCreditNote(actor,draft.id,draft.revision,"2026-07-01")).rejects.toThrow();
 const current=(await getCreditDraft(actor,draft.id))!;
 await expect(postCreditNote(actor,draft.id,current.revision,"2026-06-01")).rejects.toThrow();
 await expect(postCreditNote(actor,draft.id,current.revision,"bad")).rejects.toThrow();
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=7",[W.companyA,W.userOwnerA]);
 const sequence=(await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='CREDIT_NOTE'",[W.companyA])).rows;
 await expect(postCreditNote(actor,draft.id,current.revision,"2026-07-01")).rejects.toThrow();
 expect((await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='CREDIT_NOTE'",[W.companyA])).rows).toEqual(sequence);
 expect(await getCreditDraft(actor,draft.id)).not.toBeNull();
 await postCreditNote(actor,draft.id,current.revision,"2026-08-01");
});

it("refuses full application when another credit has already used the remaining balance",async()=>{
 const target=await invoice(),other=await invoice();const external=await credit(other,"60");
 await postCreditNote(actor,external.draft.id,external.draft.revision,"2026-08-01");
 const posted=(await getPostedCredit(actor,external.draft.id))!;
 await withCompany(actor,async tx=>{
  await tx.salesCreditApplication.update({where:{id:posted.creditsApplied[0]!.id,companyId:actor.companyId},data:{unappliedDate:new Date("2026-08-02"),unappliedById:actor.userId}});
  await tx.salesCreditApplication.create({data:{companyId:actor.companyId,creditNoteId:posted.id,invoiceId:target.id,amountCents:posted.totalCents,appliedDate:new Date("2026-08-02"),createdById:actor.userId}});
 });
 const own=await credit(target,"50");
 await expect(postCreditNote(actor,own.draft.id,own.draft.revision,"2026-08-03")).rejects.toThrow("sales.creditBalance");
 expect(await getCreditDraft(actor,own.draft.id)).not.toBeNull();
 expect(await getInvoiceOpenCents(actor,target.id)).toBe(4599n);
});
