import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { getBill, getBillOpenCents, getCreditDraft, getDraft, getPostedCredit, getSupplierCreditOpenCents, listPostedCredits, postBill, postCreditNote, saveCreditDraft, saveDraft, voidBill, voidCreditNote } from "@/modules/purchases";
import { recordDisbursement } from "@/modules/payments";
import { getPayablesAging, getTaxSummary } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA }, reader = { ...actor, userId: W.userReader };
const available = { applicationMode: "UNAPPLIED" } as const;
let db: pg.Client;
beforeAll(async () => {
 db = await owner(); await seedWorld(db);
 await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5)",[W.companyA]);
});
afterAll(async () => { await db?.end(); });
async function bill(paid = true) {
 const id = await saveDraft(actor,{contactId:W.supplier,documentDate:"2026-06-01",dueDate:"2026-07-01",lines:[{description:"Supplies",quantity:"1",unitPrice:"100",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});
 await postBill(actor,id,(await getDraft(actor,id))!.revision,"2026-06-01");
 if(paid)await recordDisbursement(actor,{billId:id,amountCents:"11498",expectedOpenCents:"11498",date:"2026-06-02",accountId:W.bank,method:"EFT"},{now:new Date("2026-12-31")});
 return (await getBill(actor,id))!;
}
async function credit(source:Awaited<ReturnType<typeof bill>>,amount="25") {
 const id = await saveCreditDraft(actor,source.id,{documentDate:"2026-06-03",memo:"Private adjustment",lines:[{lineId:source.lines[0]!.id,amount}]});
 return (await getCreditDraft(actor,id))!;
}

it("posts a credit on a fully paid bill without a second payment or application, reconciles dated payables and reverses exactly",async()=>{
 const source=await bill(),draft=await credit(source);
 const sequence=(await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='PURCHASE_DOCUMENT'",[W.companyA])).rows;
 await expect(postCreditNote(actor,draft.id,draft.revision,"2026-06-03")).rejects.toMatchObject({key:"purchases.creditBalance"});
 expect((await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='PURCHASE_DOCUMENT'",[W.companyA])).rows).toEqual(sequence);
 await postCreditNote(actor,draft.id,draft.revision,"2026-06-03",available);
 const posted=(await getPostedCredit(actor,draft.id))!;
 expect(posted).toMatchObject({status:"POSTED",subtotalCents:2500n,totalCents:2874n,supplierSnapshot:source.supplierSnapshot});
 expect(posted.creditsApplied).toHaveLength(0);expect(await getSupplierCreditOpenCents(actor,draft.id)).toBe(2874n);expect(await getBillOpenCents(actor,source.id)).toBe(0n);
 expect((await db.query("SELECT count(*)::int AS n FROM payment WHERE company_id=$1",[W.companyA])).rows[0].n).toBe(1);
 const aging=await getPayablesAging(reader,{asOf:"2026-06-03"});expect(aging).toMatchObject({unappliedCents:-2874n,totalCents:-2874n,controlCents:-2874n,differenceCents:0n});
 expect((await getPayablesAging(reader,{asOf:"2026-06-02"})).totalCents).toBe(0n);
 expect((await getTaxSummary(actor,{from:"2026-06-01",to:"2026-06-30"})).controlCents).toBe(-1124n);
 expect((await getTaxSummary(actor,{from:"2026-06-03",to:"2026-06-03"})).controlCents).toBe(374n);
 await voidCreditNote(actor,draft.id,"2026-06-04","Correction");expect(await getSupplierCreditOpenCents(actor,draft.id)).toBe(0n);
 expect((await listPostedCredits(reader,source.id))[0]).toMatchObject({status:"VOID",totalCents:2874n,availableCents:0n});
 expect((await getPayablesAging(reader,{asOf:"2026-06-03"})).totalCents).toBe(-2874n);expect((await getPayablesAging(reader,{asOf:"2026-06-04"}))).toMatchObject({totalCents:0n,differenceCents:0n});
 expect((await getTaxSummary(actor,{from:"2026-06-04",to:"2026-06-04"})).controlCents).toBe(-374n);
 const voided=(await getPostedCredit(actor,draft.id))!;
 const net=(await db.query("SELECT account_id,sum(debit_cents-credit_cents)::text AS net FROM journal_line WHERE entry_id=ANY($1::uuid[]) GROUP BY account_id",[[posted.journalEntryId,voided.voidEntryId]])).rows;
 expect(net.every(row=>row.net==="0")).toBe(true);
});

it("serializes competing source-linked available credits and never exceeds original line/tax limits",async()=>{
 const source=await bill(),first=await credit(source,"60"),second=await credit(source,"60");
 const results=await Promise.allSettled([first,second].map(draft=>postCreditNote(actor,draft.id,draft.revision,"2026-06-03",available)));
 expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
 const posted=(await listPostedCredits(actor,source.id));expect(posted).toHaveLength(1);expect(posted[0]?.availableCents).toBe(6899n);expect(await getBillOpenCents(actor,source.id)).toBe(0n);
 const remainder=await credit(source,"40");await postCreditNote(actor,remainder.id,remainder.revision,"2026-06-03",available);
 expect((await listPostedCredits(actor,source.id)).reduce((sum,row)=>sum+row.availableCents,0n)).toBe(11498n);
 const extra=await credit(source,"0.01");await expect(postCreditNote(actor,extra.id,extra.revision,"2026-06-03",available)).rejects.toMatchObject({key:"purchases.creditLimit"});
});

it("keeps posting idempotent without converting an already posted available credit into a source application",async()=>{
 const source=await bill(false),draft=await credit(source);
 const attempts=await Promise.all([1,2].map(()=>postCreditNote(actor,draft.id,draft.revision,"2026-06-03",available)));expect(attempts).toEqual([draft.id,draft.id]);
 await postCreditNote(actor,draft.id,draft.revision,"2026-06-03",{applicationMode:"SOURCE_BILL"});
 expect((await getPostedCredit(actor,draft.id))!.creditsApplied).toHaveLength(0);expect(await getBillOpenCents(actor,source.id)).toBe(11498n);expect(await getSupplierCreditOpenCents(actor,draft.id)).toBe(2874n);
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE source_id=$1",[draft.id])).rows[0].n).toBe(1);
 await expect(voidBill(actor,source.id,"2026-06-04","Source correction")).rejects.toMatchObject({key:"purchases.linked"});
});

it("refuses invalid modes, stale reviews, closed periods and read-only posting without consuming a document number",async()=>{
 const source=await bill(),draft=await credit(source);
 for(const options of [{applicationMode:"other"},{applicationMode:["UNAPPLIED","SOURCE_BILL"]},{applicationMode:null},{applicationMode:"UNAPPLIED",extra:true},null])await expect(postCreditNote(actor,draft.id,draft.revision,"2026-06-03",options as never)).rejects.toMatchObject({key:"purchases.invalidCredit"});
 await expect(postCreditNote(reader,draft.id,draft.revision,"2026-06-03",available)).rejects.toMatchObject({key:"forbidden"});
 await expect(postCreditNote(actor,draft.id,"stale","2026-06-03",available)).rejects.toMatchObject({key:"purchases.stale"});
 const sequence=(await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='PURCHASE_DOCUMENT'",[W.companyA])).rows;
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=6",[W.companyA,W.userOwnerA]);
 try{await expect(postCreditNote(actor,draft.id,draft.revision,"2026-06-03",available)).rejects.toThrow();}finally{await db.query("UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE company_id=$1 AND period_number=6",[W.companyA]);}
 expect((await db.query("SELECT next_value::text FROM number_sequence WHERE company_id=$1 AND key='PURCHASE_DOCUMENT'",[W.companyA])).rows).toEqual(sequence);expect((await getCreditDraft(actor,draft.id))?.revision).toBe(draft.revision);
 await postCreditNote(actor,draft.id,draft.revision,"2026-06-03",available);
});

it("reads availability without Contacts, Taxes or Sales and preserves accounting and company boundaries",async()=>{
 const source=await bill(),draft=await credit(source);await postCreditNote(actor,draft.id,draft.revision,"2026-06-03",available);
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",contacts:"none",taxes:"none",sales:"none"})]);
 expect(await getSupplierCreditOpenCents(reader,draft.id)).toBe(2874n);expect((await listPostedCredits(reader,source.id))[0]?.availableCents).toBe(2874n);
 const other={userId:W.userOwnerB,companyId:W.companyB};expect(await getSupplierCreditOpenCents(other,draft.id)).toBe(0n);expect(await listPostedCredits(other,source.id)).toEqual([]);
 await expect(postCreditNote(other,draft.id,draft.revision,"2026-06-03",available)).rejects.toThrow();
 await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 await expect(getSupplierCreditOpenCents(reader,draft.id)).rejects.toMatchObject({key:"forbidden"});await expect(listPostedCredits(reader)).rejects.toMatchObject({key:"forbidden"});
});
