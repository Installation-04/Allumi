import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { getTaxSummary,TAX_DETAIL_PAGE_SIZE } from "@/modules/reports";
import { saveDraft,getDraft,getInvoice,postInvoice,saveCreditDraft,getCreditDraft,postCreditNote,voidCreditNote,voidInvoice } from "@/modules/sales";
import { saveDraft as saveBill,getDraft as getBillDraft,getBill,postBill,saveCreditDraft as saveSupplierCredit,getCreditDraft as getSupplierCredit,postCreditNote as postSupplierCredit,voidCreditNote as voidSupplierCredit,voidBill,saveExpenseDraft,getExpenseDraft,postExpense,voidExpense } from "@/modules/purchases";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
let db:pg.Client,sequence=900_000;
const period={from:"2026-06-01",to:"2026-06-30"};
async function rawTax(date:string,box:"ADJUSTMENT"|"RECOVERABLE"|"SETTLEMENT",net:number,untagged=false){
 const id=randomUUID();await db.query("BEGIN");
 try{
  if(untagged)await db.query("ALTER TABLE journal_line DISABLE TRIGGER journal_line_validate");
  await db.query("INSERT INTO journal_entry(id,company_id,entry_number,entry_date,fiscal_period_id,source_type,source_id,created_by_id,memo) SELECT $1,$2,$3,$4::date,id,$5::journal_source,$6,$7,'Tax test' FROM fiscal_period WHERE company_id=$2 AND $4::date BETWEEN start_date AND end_date",[id,W.companyA,++sequence,date,box==="SETTLEMENT"?"TAX_SETTLEMENT":"MANUAL",null,W.userOwnerA]);
  await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date,tax_id,tax_box) VALUES(gen_random_uuid(),$1,$2,1,$3,$4,$5,$6::date,$7,$8::tax_box)",[W.companyA,id,box==="RECOVERABLE"?W.gstReceivable:W.gstPayable,net<0?-net:0,net>0?net:0,date,untagged?null:W.gst,untagged?null:box]);
  await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date) VALUES(gen_random_uuid(),$1,$2,2,$3,$4,$5,$6::date)",[W.companyA,id,W.bank,net>0?net:0,net<0?-net:0,date]);
  if(untagged){await db.query("SET CONSTRAINTS ALL IMMEDIATE");await db.query("ALTER TABLE journal_line ENABLE TRIGGER journal_line_validate");}
  await db.query("COMMIT");return id;
 }catch(e){await db.query("ROLLBACK");throw e;}
}
beforeAll(async()=>{
 db=await owner();await seedWorld(db);
 await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5)",[W.companyA]);
 const lines=[{description:"Service",quantity:"1",unitPrice:"100",accountId:W.sales,taxCodeId:W.taxCodeStandard}];
 const sale=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-01",dueDate:"2026-07-01",lines});await postInvoice(actor,sale,(await getDraft(actor,sale))!.revision,"2026-06-01");
 const credit=await saveCreditDraft(actor,sale,{issueDate:"2026-06-05",memo:"Correction",lines:[{lineId:(await getInvoice(actor,sale))!.lines[0]!.id,amount:"25"}]});await postCreditNote(actor,credit,(await getCreditDraft(actor,credit))!.revision,"2026-06-05");
 await voidCreditNote(actor,credit,"2026-07-02","Credit correction");await voidInvoice(actor,sale,"2026-07-05","Invoice correction");
 const bill=await saveBill(actor,{contactId:W.supplier,documentDate:"2026-06-02",dueDate:"2026-07-01",lines:[{...lines[0]!,accountId:W.expenses,unitPrice:"40"}]});await postBill(actor,bill,(await getBillDraft(actor,bill))!.revision,"2026-06-02");
 const supplierCredit=await saveSupplierCredit(actor,bill,{documentDate:"2026-06-06",memo:"Return",lines:[{lineId:(await getBill(actor,bill))!.lines[0]!.id,amount:"10"}]});await postSupplierCredit(actor,supplierCredit,(await getSupplierCredit(actor,supplierCredit))!.revision,"2026-06-06");
 await voidSupplierCredit(actor,supplierCredit,"2026-07-03","Credit correction");await voidBill(actor,bill,"2026-07-06","Bill correction");
 const expense=await saveExpenseDraft(actor,{contactId:W.supplier,documentDate:"2026-06-03",paymentAccountId:W.bank,paymentMethod:"EFT",lines:[{...lines[0]!,accountId:W.expenses,unitPrice:"10"}]});await postExpense(actor,expense,(await getExpenseDraft(actor,expense))!.revision,"2026-06-03");await voidExpense(actor,expense,"2026-07-07","Expense correction");
});
afterAll(async()=>{await db?.end();});
it("reports posted amounts by period rather than today's document status or rates",async()=>{
 const r=await getTaxSummary(actor,period);expect(r.lineCount).toBe(10);expect(r.anomalyCount).toBe(0);expect(r.differenceCents).toBe(0n);
 const [gst,qst]=r.taxes;expect(gst).toMatchObject({code:"TPS",collectedCents:375n,recoverableCents:200n,netCents:175n,settlementCents:0n});expect(qst).toMatchObject({code:"TVQ",collectedCents:749n,recoverableCents:399n,netCents:350n});expect(r.controlCents).toBe(525n);
 const july=await getTaxSummary(actor,{from:"2026-07-01",to:"2026-07-31"});expect(july.controlCents).toBe(-525n);expect(july.differenceCents).toBe(0n);
 const both=await getTaxSummary(actor,{from:"2026-06-01",to:"2026-07-31"});expect(both.taxes.every(t=>t.netCents===0n)).toBe(true);expect(both.controlCents).toBe(0n);
});
it("separates adjustments and settlements and uses only the recoverable amount actually posted",async()=>{
 await rawTax("2026-08-01","ADJUSTMENT",17);await rawTax("2026-08-02","RECOVERABLE",-42);await rawTax("2026-08-03","SETTLEMENT",-100);
 const r=await getTaxSummary(actor,{from:"2026-08-01",to:"2026-08-31"});expect(r.taxes[0]).toMatchObject({collectedCents:0n,recoverableCents:42n,adjustmentCents:17n,netCents:-25n,settlementCents:-100n,movementCents:-125n});expect(r.controlCents).toBe(-125n);expect(r.differenceCents).toBe(0n);
});
it("keeps inactive taxes with activity and requires both accounting and tax access",async()=>{
 await db.query("UPDATE tax SET is_active=false WHERE id=$1",[W.gst]);expect((await getTaxSummary(actor,period)).taxes.some(t=>t.id===W.gst)).toBe(true);
 const reader={...actor,userId:W.userReader};
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",taxes:"read",sales:"none",contacts:"none"})]);
 expect((await getTaxSummary(reader,period)).controlCents).toBe(525n);
 for(const moduleAccess of [{accounting:"none",taxes:"read"},{accounting:"read",taxes:"none"}]){await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify(moduleAccess)]);await expect(getTaxSummary(reader,period)).rejects.toThrow();}
 expect((await getTaxSummary({userId:W.userOwnerB,companyId:W.companyB},period)).lines).toEqual([]);
 await expect(getTaxSummary({userId:W.userOwnerB,companyId:W.companyA},period)).rejects.toThrow();
 await expect(getTaxSummary(actor,{from:"2026-02-30",to:"2026-06-01"})).rejects.toMatchObject({key:"reports.period"});
 await expect(getTaxSummary(actor,{from:"2026-07-01",to:"2026-06-01"})).rejects.toThrow();
});
it("paginates detail without changing totals and refuses a partial export",async()=>{
 for(let i=0;i<TAX_DETAIL_PAGE_SIZE+1;i++)await rawTax("2026-09-01","ADJUSTMENT",1);
 const p={from:"2026-09-01",to:"2026-09-30"};const first=await getTaxSummary(actor,p),last=await getTaxSummary(actor,{...p,page:999999});
 expect(first.lines).toHaveLength(100);expect(last.lines).toHaveLength(1);expect(last.page).toBe(2);expect(first.controlCents).toBe(101n);expect(last.controlCents).toBe(101n);expect(last.taxes).toEqual(first.taxes);
 const all=await getTaxSummary(actor,p,{exportAll:true});expect(all.lines).toHaveLength(101);expect(new Set(all.lines.map(l=>l.id)).size).toBe(101);
 await expect(getTaxSummary(actor,p,{exportAll:true,maxLines:100})).rejects.toMatchObject({key:"reports.tooManyLines"});
});
it("flags unclassified tax-account movements even if opposing anomalies net to zero",async()=>{
 await rawTax("2026-10-01","ADJUSTMENT",35,true);
 const r=await getTaxSummary(actor,{from:"2026-10-01",to:"2026-10-31"});expect(r.controlCents).toBe(35n);expect(r.differenceCents).toBe(35n);expect(r.anomalyCount).toBe(1);expect(r.lines).toEqual([]);
 await rawTax("2026-10-02","ADJUSTMENT",-35,true);
 const balanced=await getTaxSummary(actor,{from:"2026-10-01",to:"2026-10-31"});expect(balanced.differenceCents).toBe(0n);expect(balanced.anomalyCount).toBe(2);
});
