import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll,beforeAll,expect,it } from "vitest";
import { applySupplierCredit,unapplySupplierCredit,listSupplierCreditTargets,listSupplierCreditApplications,getSupplierCreditOpenCents,getBillOpenCents,saveDraft,getDraft,getBill,postBill,saveCreditDraft,getCreditDraft,postCreditNote,voidCreditNote,voidBill } from "@/modules/purchases";
import { recordDisbursement } from "@/modules/payments";
import { getPayablesAging,getTaxSummary,getSupplierStatement } from "@/modules/reports";
import { owner } from "./helpers";
import { appClient,asOwnerA,inContext,setContext,seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader};
let db:pg.Client;
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5)",[W.companyA]);});
afterAll(async()=>{await db?.end();});
async function bill(reference="",supplier:string=W.supplier){
 const id=await saveDraft(actor,{contactId:supplier,supplierReference:reference ? `${reference}-${randomUUID()}` : undefined,documentDate:"2026-01-01",dueDate:"2026-02-01",lines:[{description:"Application fixture",quantity:"1",unitPrice:"1",accountId:W.expenses,taxCodeId:W.taxCodeExempt}]});
 await postBill(actor,id,(await getDraft(actor,id))!.revision,"2026-01-01");return id;
}
async function fixtures(){
 const source=await bill(),original=(await getBill(actor,source))!;
 const credit=await saveCreditDraft(actor,source,{documentDate:"2026-01-02",memo:"Private supplier adjustment",lines:[{lineId:original.lines[0]!.id,amount:"1"}]});
 await postCreditNote(actor,credit,(await getCreditDraft(actor,credit))!.revision,"2026-01-02",{applicationMode:"UNAPPLIED"});return {source,credit,target:await bill("Target%_\\Nord")};
}
const input=(credit:string,target:string,values:Record<string,string|undefined>={})=>({supplierCreditId:credit,billId:target,amountCents:"40",expectedCreditCents:"100",expectedBillCents:"100",date:"2026-01-10",...values});

it("applies and releases exactly without a new journal entry, preserving dated payable and tax reports",async()=>{
 const f=await fixtures();const entries=(await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;
 const before=await getPayablesAging(reader,{asOf:"2026-01-11"});const taxes=await getTaxSummary(actor,{from:"2026-01-01",to:"2026-01-31"});
 const statement=await getSupplierStatement(actor,{contactId:W.supplier,from:"2026-01-01",to:"2026-01-31"});
 const application=await applySupplierCredit(actor,input(f.credit,f.target));
 expect(await getSupplierStatement(actor,{contactId:W.supplier,from:"2026-01-01",to:"2026-01-31"})).toEqual(statement);
 expect(await getSupplierCreditOpenCents(reader,f.credit)).toBe(60n);expect(await getBillOpenCents(reader,f.target)).toBe(60n);
 const dated=await getPayablesAging(reader,{asOf:"2026-01-11"});expect(dated.totalCents).toBe(before.totalCents);expect(dated.differenceCents).toBe(0n);
 expect(dated.customers.flatMap(c=>c.items).find(row=>row.id===f.target)?.cents).toBe(60n);
 expect((await getPayablesAging(reader,{asOf:"2026-01-09"})).customers.flatMap(c=>c.items).find(row=>row.id===f.target)?.cents).toBe(100n);
 await expect(voidCreditNote(actor,f.credit,"2026-01-11","Correction")).rejects.toMatchObject({key:"purchases.creditVoidLinked"});
 await expect(voidBill(actor,f.target,"2026-01-11","Correction")).rejects.toMatchObject({key:"purchases.linked"});
 await unapplySupplierCredit(actor,application.id,{date:"2026-01-12"});
 expect(await getSupplierCreditOpenCents(reader,f.credit)).toBe(100n);expect(await getBillOpenCents(reader,f.target)).toBe(100n);
 await expect(unapplySupplierCredit(actor,application.id,{date:"2026-01-15"})).resolves.toBe(application.id);
 expect((await listSupplierCreditApplications(reader,f.credit)).applications[0]).toMatchObject({amountCents:40n,appliedDate:"2026-01-10",unappliedDate:"2026-01-12"});
 expect((await getPayablesAging(reader,{asOf:"2026-01-11"})).customers.flatMap(c=>c.items).find(row=>row.id===f.target)?.cents).toBe(60n);
 expect((await getPayablesAging(reader,{asOf:"2026-01-12"})).differenceCents).toBe(0n);
 expect((await getTaxSummary(actor,{from:"2026-01-01",to:"2026-01-31"})).taxes).toEqual(taxes.taxes);
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(entries);
 await voidCreditNote(actor,f.credit,"2026-01-13","Credit correction");expect((await getPayablesAging(reader,{asOf:"2026-01-11"})).differenceCents).toBe(0n);
});

it("serializes competing submissions and refuses stale reviews or a second active link",async()=>{
 const f=await fixtures();const attempts=await Promise.allSettled([1,2].map(()=>applySupplierCredit(actor,input(f.credit,f.target))));
 expect(attempts.filter(row=>row.status==="fulfilled")).toHaveLength(1);expect(attempts.filter(row=>row.status==="rejected")).toHaveLength(1);
 await expect(applySupplierCredit(actor,input(f.credit,f.target))).rejects.toMatchObject({key:"supplierApplications.stale"});
 await expect(applySupplierCredit(actor,input(f.credit,f.target,{amountCents:"1",expectedCreditCents:"60",expectedBillCents:"60"}))).rejects.toMatchObject({key:"supplierApplications.alreadyApplied"});
 expect((await listSupplierCreditApplications(reader,f.credit)).total).toBe(1);
 const another=await bill();const a=await fixtures();
 const competing=await Promise.allSettled([a.target,another].map(target=>applySupplierCredit(actor,input(a.credit,target,{amountCents:"80"}))));
 expect(competing.filter(row=>row.status==="fulfilled")).toHaveLength(1);expect(await getSupplierCreditOpenCents(reader,a.credit)).toBe(20n);
});

it("prevents future/backdated/closed-period settlements and spending availability restored later",async()=>{
 const f=await fixtures();
 await expect(applySupplierCredit(actor,input(f.credit,f.target,{date:"2026-01-01"}))).rejects.toMatchObject({key:"supplierApplications.dateBeforeDocuments"});
 await expect(applySupplierCredit(actor,input(f.credit,f.target,{date:"2999-01-01"}))).rejects.toMatchObject({key:"supplierApplications.futureDate"});
 await recordDisbursement(actor,{billId:f.target,amountCents:"20",expectedOpenCents:"100",date:"2026-01-10",accountId:W.bank,method:"EFT"});
 await expect(applySupplierCredit(actor,input(f.credit,f.target,{expectedBillCents:"80",date:"2026-01-09"}))).rejects.toMatchObject({key:"supplierApplications.dateBeforeMovement"});
 const application=await applySupplierCredit(actor,input(f.credit,f.target,{expectedBillCents:"80",date:"2026-01-11"}));
 await expect(unapplySupplierCredit(actor,application.id,{date:"2026-01-10"})).rejects.toThrow();await unapplySupplierCredit(actor,application.id,{date:"2026-01-12"});
 await expect(applySupplierCredit(actor,input(f.credit,f.target,{expectedBillCents:"80",date:"2026-01-11"}))).rejects.toMatchObject({key:"supplierApplications.dateBeforeMovement"});
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=1",[W.companyA,W.userOwnerA]);
 try{await expect(applySupplierCredit(actor,input(f.credit,f.target,{expectedBillCents:"80",date:"2026-01-12"}))).rejects.toMatchObject({key:"supplierApplications.periodClosed"});}finally{await db.query("UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE company_id=$1 AND period_number=1",[W.companyA]);}
});

it("requires accounting write only, respects tenant/contact boundaries and reads without directories",async()=>{
 const f=await fixtures();await expect(applySupplierCredit(reader,input(f.credit,f.target))).rejects.toMatchObject({key:"forbidden"});
 const other={userId:W.userOwnerB,companyId:W.companyB};expect(await listSupplierCreditTargets(other,f.credit).catch(()=>null)).toBeNull();await expect(applySupplierCredit(other,input(f.credit,f.target))).rejects.toThrow();
 const supplier=randomUUID();await db.query("INSERT INTO contact(id,company_id,is_supplier,display_name,updated_at) VALUES($1,$2,true,'Other supplier',now())",[supplier,W.companyA]);const wrong=await bill("Wrong supplier",supplier);
 await expect(applySupplierCredit(actor,input(f.credit,wrong))).rejects.toMatchObject({key:"supplierApplications.supplierMismatch"});
 const accountant={...actor,userId:W.userAccountant};await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant,JSON.stringify({accounting:"write",contacts:"none",taxes:"none",sales:"none"})]);
 expect((await listSupplierCreditTargets(accountant,f.credit,"%_\\")).bills.map(row=>row.id)).toContain(f.target);expect((await listSupplierCreditTargets(accountant,f.credit,"Wrong supplier")).bills).toEqual([]);
 const a=await applySupplierCredit(accountant,input(f.credit,f.target));expect((await listSupplierCreditApplications(accountant,f.credit)).total).toBe(1);await unapplySupplierCredit(accountant,a.id,{date:"2026-01-11"});
 for(const bad of [{amountCents:"0"},{amountCents:"101"},{expectedBillCents:"99"},{date:"2026-02-30"}])await expect(applySupplierCredit(actor,input(f.credit,f.target,{date:"2026-01-12",...bad}))).rejects.toThrow();
});

it("bounds history and target search while preserving literal wildcards and released applications",async()=>{
 const f=await fixtures();for(let i=0;i<26;i++){const a=await applySupplierCredit(actor,input(f.credit,f.target,{amountCents:"1"}));await unapplySupplierCredit(actor,a.id,{date:"2026-01-10"});}
 const first=await listSupplierCreditApplications(reader,f.credit),second=await listSupplierCreditApplications(reader,f.credit,2);
 expect(first.applications).toHaveLength(25);expect(second.applications).toHaveLength(1);expect(new Set([...first.applications,...second.applications].map(row=>row.id)).size).toBe(26);expect(first.total).toBe(26);
 expect((await listSupplierCreditTargets(reader,f.credit,"Target%_\\Nord")).bills.some(row=>row.id===f.target)).toBe(true);
 expect((await listSupplierCreditTargets(reader,f.credit,"missing%")).bills).toEqual([]);
 await expect(listSupplierCreditTargets(reader,f.credit,"\u0000")).rejects.toThrow();
});

it("rejects stale REPEATABLE READ applications after another committed application and document cancellation snapshots",async()=>{
 const f=await fixtures();const client=await appClient();
 try{
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");await setContext(client,asOwnerA);await client.query("SELECT purchase_document_open_cents($1,$2)",[W.companyA,f.credit]);
  await applySupplierCredit(actor,input(f.credit,f.target));
  await expect(client.query("INSERT INTO purchase_credit_application(id,company_id,supplier_credit_id,bill_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,80,'2026-01-10',$5)",[randomUUID(),W.companyA,f.credit,f.target,W.userOwnerA])).rejects.toMatchObject({code:"AL007",message:"supplier applications require read committed isolation"});
 }finally{await client.query("ROLLBACK");await client.end();}
 const stale=await appClient();try{await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");await setContext(stale,asOwnerA);await expect(stale.query("UPDATE purchase_document SET status='VOID' WHERE company_id=$1 AND id=$2",[W.companyA,f.credit])).rejects.toMatchObject({code:"AL006"});}finally{await stale.query("ROLLBACK");await stale.end();}
});

it("enforces chronology and immutable releases through raw application writes",async()=>{
 const f=await fixtures();const a=await applySupplierCredit(actor,input(f.credit,f.target));await unapplySupplierCredit(actor,a.id,{date:"2026-01-12"});
 const client=await appClient();try{
  await expect(inContext(client,asOwnerA,()=>client.query("INSERT INTO purchase_credit_application(id,company_id,supplier_credit_id,bill_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,10,'2026-01-11',$5)",[randomUUID(),W.companyA,f.credit,f.target,W.userOwnerA]))).rejects.toMatchObject({code:"AL007"});
  await expect(inContext(client,asOwnerA,()=>client.query("UPDATE purchase_credit_application SET unapplied_date='2026-01-13' WHERE company_id=$1 AND id=$2",[W.companyA,a.id]))).rejects.toMatchObject({code:"AL007"});
  await expect(inContext(client,asOwnerA,()=>client.query("DELETE FROM purchase_credit_application WHERE company_id=$1 AND id=$2",[W.companyA,a.id]))).rejects.toMatchObject({code:"42501"});
 }finally{await client.end();}
});


it("serializes a supplier payment against a credit application on the same open bill",async()=>{
 const f=await fixtures();
 const results=await Promise.allSettled([
  applySupplierCredit(actor,input(f.credit,f.target,{amountCents:"80"})),
  recordDisbursement(actor,{billId:f.target,amountCents:"80",expectedOpenCents:"100",date:"2026-01-10",accountId:W.bank,method:"EFT"}),
 ]);
 expect(results.filter(row=>row.status==="fulfilled")).toHaveLength(1);
 expect(results.filter(row=>row.status==="rejected")).toHaveLength(1);
 expect(await getBillOpenCents(reader,f.target)).toBe(20n);
 expect(await getSupplierCreditOpenCents(reader,f.credit)).toBe(results[0].status==="fulfilled" ? 20n : 100n);
 expect((await getPayablesAging(reader,{asOf:"2026-01-10"})).differenceCents).toBe(0n);
});

it("bounds the bill picker to fifty results and signals that a narrower search is needed",async()=>{
 const f=await fixtures();for(let i=0;i<51;i++)await bill("Picker-bound");
 const results=await listSupplierCreditTargets(reader,f.credit,"Picker-bound");
 expect(results.bills).toHaveLength(50);expect(results.hasMore).toBe(true);
});


it("rejects raw future, initially released and closed-period applications",async()=>{
 const f=await fixtures(),client=await appClient();
 const insert=(date:string,released:string|null=null)=>inContext(client,asOwnerA,()=>client.query("INSERT INTO purchase_credit_application(id,company_id,supplier_credit_id,bill_id,amount_cents,applied_date,created_by_id,unapplied_date,unapplied_by_id) VALUES($1,$2,$3,$4,10,$5,$6,$7,$8)",[randomUUID(),W.companyA,f.credit,f.target,date,W.userOwnerA,released,released ? W.userOwnerA : null]));
 try{
  await expect(insert("2999-01-10")).rejects.toMatchObject({code:"AL007"});
  await expect(insert("2026-01-10","2026-01-10")).rejects.toMatchObject({code:"AL007"});
  await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=1",[W.companyA,W.userOwnerA]);
  try{await expect(insert("2026-01-10")).rejects.toMatchObject({code:"AL003"});}finally{await db.query("UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE company_id=$1 AND period_number=1",[W.companyA]);}
 }finally{await client.end();}
 const original=(await getBill(actor,f.source))!;
 const draft=await saveCreditDraft(actor,f.source,{documentDate:"2026-01-03",memo:"Another correction",lines:[{lineId:original.lines[0]!.id,amount:"0.50"}]});
 const stale=await appClient();try{
  await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");await setContext(stale,asOwnerA);
  await expect(stale.query("UPDATE purchase_document SET status='POSTED' WHERE company_id=$1 AND id=$2",[W.companyA,draft])).rejects.toMatchObject({code:"AL006"});
 }finally{await stale.query("ROLLBACK");await stale.end();}
});
