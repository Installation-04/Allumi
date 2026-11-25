import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { getCashForecast } from "@/modules/reports";
import { saveDraft,getDraft,postInvoice,voidInvoice,getInvoice,saveCreditDraft,getCreditDraft,postCreditNote } from "@/modules/sales";
import { saveDraft as saveBill,getDraft as getBillDraft,postBill } from "@/modules/purchases";
import { recordReceipt,voidReceipt,recordDisbursement } from "@/modules/payments";
import { postManualEntry } from "@/modules/ledger";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
let db:pg.Client,invoice:string,bill:string,future:string,payment:string;
const report=(asOf='2026-06-30',days=30)=>getCashForecast(actor,{asOf,days});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'PAYMENT_SENT',1,'D-',5)",[W.companyA]);
 const sale=async(date:string,due:string)=>{const id=await saveDraft(actor,{contactId:W.customer,issueDate:date,dueDate:due,lines:[{description:'Forecast service',quantity:'1',unitPrice:'100',accountId:W.sales,taxCodeId:W.taxCodeStandard}]});await postInvoice(actor,id,(await getDraft(actor,id))!.revision,date);return id;};
 invoice=await sale('2026-06-01','2026-07-05');future=await sale('2026-07-01','2026-07-10');await sale('2026-06-02','2026-09-01');
 bill=await saveBill(actor,{contactId:W.supplier,documentDate:'2026-06-01',dueDate:'2026-06-20',lines:[{description:'Forecast purchase',quantity:'1',unitPrice:'100',accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});await postBill(actor,bill,(await getBillDraft(actor,bill))!.revision,'2026-06-01');
 payment=(await recordReceipt(actor,{invoiceId:invoice,amountCents:'5000',expectedOpenCents:'11498',date:'2026-06-15',accountId:W.bank,method:'EFT'},{now:new Date('2026-12-31')})).id;
 await recordDisbursement(actor,{billId:bill,amountCents:'2000',expectedOpenCents:'11498',date:'2026-07-10',accountId:W.bank,method:'EFT'},{now:new Date('2026-12-31')});
 await voidReceipt(actor,payment,{date:'2026-08-01',reason:'Historical test'});await voidInvoice(actor,future,'2026-09-01','Historical test');
});
afterAll(async()=>{await db?.end();});
it('shares dated cash, customer and supplier balances in a read-only snapshot',async()=>{
 const counts=await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM audit_log)::text AS audit');
 const r=await report();expect(r).toMatchObject({openingCents:5000n,incomingCents:6498n,outgoingCents:11498n,closingCents:0n,minimumCents:-6498n,carriedCount:1,beyondCount:1,excludedCount:0,receivableDifferenceCents:0n,payableDifferenceCents:0n,futureCashCount:1,futureCashCents:-2000n});expect(r.items.map(i=>i.id).sort()).toEqual([invoice,bill].sort());expect(r.items.find(i=>i.id===invoice)!.party).toBe('Client Fictif');expect(r.daily[0]!.closingCents).toBe(-6498n);expect(r.daily[4]!.closingCents).toBe(0n);
 expect((await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM audit_log)::text AS audit')).rows).toEqual(counts.rows);
 const all=await getCashForecast(actor,{asOf:'2026-06-30',days:30,page:99},{allRows:true});expect(all.items).toEqual(r.items);expect(all.closingCents).toBe(r.closingCents);
});
it('reconstructs payments and voids at the reference cutoff and excludes future-posted documents',async()=>{
 const july=await report('2026-07-31');expect(july.items.find(i=>i.id===invoice)!.cents).toBe(6498n);expect(july.items.find(i=>i.id===bill)!.cents).toBe(9498n);expect(july.items.some(i=>i.id===future)).toBe(true);expect(july.openingCents).toBe(3000n);expect(july.receivableDifferenceCents).toBe(0n);
 expect((await report('2026-08-01')).items.find(i=>i.id===invoice)!.cents).toBe(11498n);expect((await report('2026-09-01')).items.some(i=>i.id===future)).toBe(false);
});
it('excludes an unapplied credit and ignores pure cash transfers',async()=>{
 const source=(await getInvoice(actor,invoice))!;
 const credit=await saveCreditDraft(actor,invoice,{issueDate:'2026-06-20',memo:'Unapplied forecast credit',lines:[{lineId:source.lines[0]!.id,amount:'10'}]});await postCreditNote(actor,credit,(await getCreditDraft(actor,credit))!.revision,'2026-06-20',{applicationMode:'UNAPPLIED'});
 const r=await report();expect(r.excludedCount).toBe(1);expect(r.incomingCents).toBe(6498n);expect(r.receivableDifferenceCents).toBe(0n);
 const cash=(await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES(gen_random_uuid(),$1,'1020','Caisse','Cash','ASSET','CASH',now()) RETURNING id",[W.companyA])).rows[0].id;
 await postManualEntry(actor,{date:'2026-07-12',kind:'MANUAL',memo:'Internal cash transfer',lines:[{accountId:cash,debitCents:100n,creditCents:0n},{accountId:W.bank,debitCents:0n,creditCents:100n}]});
 const next=await report();expect(next.futureCashCount).toBe(1);expect(next.futureCashCents).toBe(-2000n);expect(next.openingCents).toBe(5000n);
});
it('compares both delays from a single dated snapshot without mutations or changing contractual dates',async()=>{
 const counts=(await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM audit_log)::text AS audit')).rows;
 const r=await getCashForecast(actor,{asOf:'2026-06-30',days:30,receiptDelay:7,paymentDelay:14});
 expect(r.baseline).toMatchObject({closingCents:0n,minimumCents:-6498n,minimumDate:'2026-07-01'});expect(r).toMatchObject({openingCents:5000n,closingCents:0n,minimumCents:0n,minimumDate:'2026-07-15',negativeDays:0,receivableDifferenceCents:0n,payableDifferenceCents:0n});
 expect(r.items.find(i=>i.id===invoice)).toMatchObject({projectedDate:'2026-07-12',dueDate:'2026-07-05',cents:6498n});expect(r.items.find(i=>i.id===bill)).toMatchObject({projectedDate:'2026-07-15',dueDate:'2026-06-20',cents:11498n});
 const deferred=await getCashForecast(actor,{asOf:'2026-06-30',days:30,receiptDelay:30});expect(deferred).toMatchObject({closingCents:-6498n,deferredIncomingCount:1,deferredIncomingCents:6498n,beyondCount:2});expect(deferred.baseline).toMatchObject({incomingCents:6498n,closingCents:0n});
 expect((await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM audit_log)::text AS audit')).rows).toEqual(counts);
 for(const receiptDelay of [-1,1,NaN])await expect(getCashForecast(actor,{asOf:'2026-06-30',days:30,receiptDelay})).rejects.toMatchObject({key:'reports.forecastDate'});
});
it('retains inactive bank balances, frozen names and access without contacts or taxes',async()=>{
 await db.query('UPDATE account SET is_active=false WHERE id=$1',[W.bank]);await db.query("UPDATE contact SET display_name='Renamed after posting' WHERE id=$1",[W.customer]);
 const reader={...actor,userId:W.userReader};await db.query('UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2',[W.companyA,W.userReader,JSON.stringify({accounting:'read',sales:'read',contacts:'none',taxes:'none'})]);
 const r=await getCashForecast(reader,{asOf:'2026-06-30',days:30});expect(r.openingCents).toBe(5000n);expect(r.accounts[0]!.isActive).toBe(false);expect(r.items.find(i=>i.id===invoice)!.party).toBe('Client Fictif');
 for(const access of [{accounting:'none',sales:'read'},{accounting:'read',sales:'none'}]){await db.query('UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2',[W.companyA,W.userReader,JSON.stringify(access)]);await expect(getCashForecast(reader,{asOf:'2026-06-30',days:30,receiptDelay:7,paymentDelay:14})).rejects.toThrow();}
});
it('isolates companies and refuses invalid dates and horizons',async()=>{
 expect((await getCashForecast({userId:W.userOwnerB,companyId:W.companyB},{asOf:'2026-06-30',days:30})).items).toEqual([]);await expect(getCashForecast({...actor,userId:W.userOwnerB},{asOf:'2026-06-30',days:30})).rejects.toThrow();
 for(const [asOf,days] of [['2026-02-30',30],['9999-01-01',30],['2026-06-30',14]] as const)await expect(report(asOf,days)).rejects.toMatchObject({key:'reports.forecastDate'});
});

it('paginates all invoices deterministically while preserving complete totals and export',async()=>{
 for(let i=0;i<101;i++){const id=await saveDraft(actor,{contactId:W.otherCustomer,issueDate:'2026-10-01',dueDate:'2026-10-20',lines:[{description:'Pagination',quantity:'1',unitPrice:'1',accountId:W.sales,taxCodeId:W.taxCodeExempt}]});await postInvoice(actor,id,(await getDraft(actor,id))!.revision,'2026-10-01');}
 const input={asOf:'2026-10-01',days:30},first=await getCashForecast(actor,input),second=await getCashForecast(actor,{...input,page:2}),all=await getCashForecast(actor,input,{allRows:true});
 expect(first.items).toHaveLength(100);expect(second.items.length).toBeGreaterThan(0);expect(first.pageCount).toBe(2);expect(second.incomingCents).toBe(first.incomingCents);expect(all.items.map(i=>i.id)).toEqual([...first.items,...second.items].map(i=>i.id));expect((await getCashForecast(actor,{...input,page:999})).page).toBe(2);
},60_000);
