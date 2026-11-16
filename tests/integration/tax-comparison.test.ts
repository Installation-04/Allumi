import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { getTaxComparison,getTaxSummary,taxSummaryTotals } from "@/modules/reports";
import { saveDraft,getDraft,getInvoice,postInvoice,saveCreditDraft,getCreditDraft,postCreditNote,voidCreditNote,voidInvoice } from "@/modules/sales";
import { saveExpenseDraft,getExpenseDraft,postExpense,voidExpense } from "@/modules/purchases";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader};
const june={from:"2026-06-01",to:"2026-06-30"},july={from:"2026-07-01",to:"2026-07-31"};
let db:pg.Client,sequence=900_000;
async function rawTax(date:string,box:"ADJUSTMENT"|"RECOVERABLE"|"SETTLEMENT",cents:bigint,untagged=false){
 const id=randomUUID();await db.query("BEGIN");
 try {
  if(untagged)await db.query("ALTER TABLE journal_line DISABLE TRIGGER journal_line_validate");
  await db.query("INSERT INTO journal_entry(id,company_id,entry_number,entry_date,fiscal_period_id,source_type,created_by_id,memo) SELECT $1,$2,$3,$4::date,id,$5::journal_source,$6,'PRIVATE-JOURNAL-NOTE' FROM fiscal_period WHERE company_id=$2 AND $4::date BETWEEN start_date AND end_date",[id,W.companyA,++sequence,date,box==="SETTLEMENT"?"TAX_SETTLEMENT":"MANUAL",W.userOwnerA]);
  await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date,tax_id,tax_box) VALUES(gen_random_uuid(),$1,$2,1,$3,$4,$5,$6::date,$7,$8::tax_box)",[W.companyA,id,box==="RECOVERABLE"?W.gstReceivable:W.gstPayable,String(cents<0n?-cents:0n),String(cents>0n?cents:0n),date,untagged?null:W.gst,untagged?null:box]);
  await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date) VALUES(gen_random_uuid(),$1,$2,2,$3,$4,$5,$6::date)",[W.companyA,id,W.bank,String(cents>0n?cents:0n),String(cents<0n?-cents:0n),date]);
  if(untagged){await db.query("SET CONSTRAINTS ALL IMMEDIATE");await db.query("ALTER TABLE journal_line ENABLE TRIGGER journal_line_validate");}
  await db.query("COMMIT");
 }catch(error){await db.query("ROLLBACK");throw error;}
}
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5)",[W.companyA]);
 const invoice=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-01",dueDate:"2026-07-01",lines:[{description:"Service",quantity:"1",unitPrice:"100",accountId:W.sales,taxCodeId:W.taxCodeStandard}]});await postInvoice(actor,invoice,(await getDraft(actor,invoice))!.revision,"2026-06-01");
 const credit=await saveCreditDraft(actor,invoice,{issueDate:"2026-06-05",memo:"PRIVATE-CREDIT",lines:[{lineId:(await getInvoice(actor,invoice))!.lines[0]!.id,amount:"25"}]});await postCreditNote(actor,credit,(await getCreditDraft(actor,credit))!.revision,"2026-06-05");
 await voidCreditNote(actor,credit,"2026-07-02","PRIVATE-REVERSAL");await voidInvoice(actor,invoice,"2026-07-05","PRIVATE-INVOICE");
 const expense=await saveExpenseDraft(actor,{contactId:W.supplier,documentDate:"2026-06-03",paymentAccountId:W.bank,paymentMethod:"EFT",lines:[{description:"Supplies",quantity:"1",unitPrice:"40",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});await postExpense(actor,expense,(await getExpenseDraft(actor,expense))!.revision,"2026-06-03");await voidExpense(actor,expense,"2026-07-07","PRIVATE-EXPENSE");
});
afterAll(async()=>{await db?.end();});
it("matches both source tax summaries exactly with original and reversed entries in their posted periods",async()=>{
 const before=(await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;
 const report=await getTaxComparison(reader,{current:june,reference:july});
 for(const [side,p] of [[report.current,june],[report.reference,july]] as const){const source=await getTaxSummary(reader,p);expect(side.taxes).toEqual(source.taxes);expect(side.controlCents).toBe(source.controlCents);expect(side.differenceCents).toBe(source.differenceCents);expect(side.lineCount).toBe(source.lineCount);expect(side.anomalyCount).toBe(source.anomalyCount);}
 expect(report.totals.netCents).toMatchObject({currentCents:525n,referenceCents:-525n,differenceCents:1050n});expect(report.taxes[0]?.amounts.netCents.differenceCents).toBe(350n);
 expect(JSON.stringify(report,(_,v)=>typeof v==="bigint"?v.toString():v)).not.toContain("PRIVATE");
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(before);
});
it("keeps settlements separate, handles overlapping periods independently and preserves exact signed changes",async()=>{
 await rawTax("2026-08-01","ADJUSTMENT",17n);await rawTax("2026-08-02","RECOVERABLE",-42n);await rawTax("2026-08-03","SETTLEMENT",-100n);
 const report=await getTaxComparison(reader,{current:{from:"2026-08-01",to:"2026-08-31"},reference:june});
 expect(report.totals.netCents).toMatchObject({currentCents:-25n,referenceCents:525n,differenceCents:-550n});expect(report.totals.settlementCents.currentCents).toBe(-100n);expect(report.totals.movementCents.currentCents).toBe(-125n);expect(report.current.differenceCents).toBe(0n);
 const overlap=await getTaxComparison(reader,{current:{from:"2026-08-01",to:"2026-08-03"},reference:{from:"2026-08-02",to:"2026-08-31"}});expect(overlap.totals.movementCents.differenceCents).toBe(17n);
 const identical=await getTaxComparison(reader,{current:june,reference:june});expect(Object.values(identical.totals).every(a=>a.differenceCents===0n)).toBe(true);expect(identical.totals.netCents.currentCents).toBe(525n);
});
it("retains anomalies per period even when unclassified opposite movements cancel to zero",async()=>{
 await rawTax("2026-10-01","ADJUSTMENT",35n,true);await rawTax("2026-10-02","ADJUSTMENT",-35n,true);
 const report=await getTaxComparison(reader,{current:{from:"2026-10-01",to:"2026-10-31"},reference:june});expect(report.current).toMatchObject({anomalyCount:2,differenceCents:0n,controlCents:0n,lineCount:0});expect(report.reference.anomalyCount).toBe(0);
});
it("keeps inactive taxes with activity on either side and zero-fills the other period",async()=>{
 await db.query("UPDATE tax SET is_active=false WHERE id=$1",[W.gst]);
 const report=await getTaxComparison(reader,{current:{from:"2026-11-01",to:"2026-11-30"},reference:june});
 expect(report.taxes.find(row=>row.id===W.gst)?.amounts.netCents).toMatchObject({currentCents:0n,referenceCents:175n,differenceCents:-175n});
 expect(taxSummaryTotals(report.reference.taxes).netCents).toBe(525n);
 const empty=await getTaxComparison(reader,{current:{from:"2026-11-01",to:"2026-11-30"},reference:{from:"2026-12-01",to:"2026-12-31"}});expect(empty.taxes.some(row=>row.id===W.gst)).toBe(false);expect(empty.current.anomalyCount).toBe(0);
});
it("requires accounting and taxes independently, isolates companies, and rejects invalid dates",async()=>{
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",taxes:"read",contacts:"none",sales:"none"})]);expect((await getTaxComparison(reader,{current:june,reference:july})).current.controlCents).toBe(525n);
 for(const access of [{accounting:"none",taxes:"read"},{accounting:"read",taxes:"none"}]){await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify(access)]);await expect(getTaxComparison(reader,{current:june,reference:july})).rejects.toMatchObject({key:"forbidden"});}
 const other={userId:W.userOwnerB,companyId:W.companyB};const empty=await getTaxComparison(other,{current:june,reference:july});expect(empty.taxes).toEqual([]);expect(empty.current.controlCents).toBe(0n);expect(empty.reference.anomalyCount).toBe(0);
 await expect(getTaxComparison({userId:W.userOwnerB,companyId:W.companyA},{current:june,reference:july})).rejects.toThrow();
 for(const p of [{from:"2026-02-30",to:"2026-03-31"},{from:"2026-03-31",to:"2026-02-01"}])await expect(getTaxComparison(actor,{current:p,reference:june})).rejects.toMatchObject({key:"reports.period"});
});
