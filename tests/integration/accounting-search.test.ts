import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { searchCompany } from "@/modules/search";
import { createAccount,updateAccount,postManualEntry,reverseEntry,getEntry,MAX_LINE_CENTS } from "@/modules/ledger";
import { getAccountLedger } from "@/modules/reports";
import { saveDraft,getDraft,postInvoice,voidInvoice } from "@/modules/sales";
import { saveDraft as saveBill,getDraft as getBill,postBill,voidBill } from "@/modules/purchases";
import { recordDisbursement,voidDisbursement } from "@/modules/payments";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader};
let db:pg.Client,accountId:string,manual:string,opening:string,reversal:string,large:string;const excluded:string[]=[];
const largeCents=9007199254740993n;
const post=(date:string,amount:bigint,kind:"MANUAL"|"OPENING_BALANCE"="MANUAL",accountId:string=W.bank)=>postManualEntry(actor,{date,kind,memo:"PRIVATE-JOURNAL-MEMO",lines:[{accountId,debitCents:amount,creditCents:0n,description:"PRIVATE-LINE-DESCRIPTION"},{accountId:W.capital,debitCents:0n,creditCents:amount}]});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'GL-',3),($1,'INVOICE',1,'F-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5)",[W.companyA]);
 accountId=(await createAccount(actor,{code:"1099",nameFr:'Recherche%_\\ Nord',nameEn:'Search%_\\ North',type:"ASSET",subtype:"BANK",description:"PRIVATE-ACCOUNT-DESCRIPTION"})).id;
 opening=(await post("2026-01-01",100n,"OPENING_BALANCE")).id;
 manual=(await post("2026-06-01",12345n,"MANUAL",accountId)).id;reversal=(await reverseEntry(actor,manual,{date:"2026-06-02",memo:"PRIVATE-REVERSAL-REASON"})).id;
 await updateAccount(actor,accountId,{isActive:false});
 const parts:bigint[]=[];for(let left=largeCents;left>0n;){const amount=left>MAX_LINE_CENTS?MAX_LINE_CENTS:left;parts.push(amount);left-=amount;}
 large=(await postManualEntry(actor,{date:"2026-06-03",kind:"MANUAL",memo:"PRIVATE-LARGE",lines:[...parts.map(amount=>({accountId:W.bank,debitCents:amount,creditCents:0n})),...parts.map(amount=>({accountId:W.capital,debitCents:0n,creditCents:amount}))]})).id;
 const invoice=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-10",dueDate:"2026-07-10",lines:[{description:"PRIVATE-SALES",quantity:"1",unitPrice:"123.45",accountId:W.sales,taxCodeId:W.taxCodeExempt}]});await postInvoice(actor,invoice,(await getDraft(actor,invoice))!.revision,"2026-06-10");await voidInvoice(actor,invoice,"2026-06-11","PRIVATE-SALES-VOID");
 const bill=await saveBill(actor,{contactId:W.supplier,documentDate:"2026-06-12",dueDate:"2026-07-12",lines:[{description:"PRIVATE-PURCHASE",quantity:"1",unitPrice:"123.45",accountId:W.expenses,taxCodeId:W.taxCodeExempt}]});await postBill(actor,bill,(await getBill(actor,bill))!.revision,"2026-06-12");const payment=await recordDisbursement(actor,{billId:bill,amountCents:"12345",expectedOpenCents:"12345",date:"2026-06-13",accountId:W.bank,method:"EFT"});await voidDisbursement(actor,payment.id,{date:"2026-06-14",reason:"PRIVATE-PAYMENT-VOID"});await voidBill(actor,bill,"2026-06-15","PRIVATE-BILL-VOID");
 excluded.push(...(await db.query("SELECT id FROM journal_entry WHERE company_id=$1 AND (source_type IN ('SALES_DOCUMENT','PURCHASE_DOCUMENT','PAYMENT') OR (source_type='REVERSAL' AND reverses_entry_id IN(SELECT id FROM journal_entry WHERE company_id=$1 AND source_type IN('SALES_DOCUMENT','PURCHASE_DOCUMENT','PAYMENT'))))",[W.companyA])).rows.map(row=>row.id));
});
afterAll(async()=>{await db?.end();});
it("finds both account languages literally, includes inactive accounts and opens a read-only ledger",async()=>{
 for(const q of ["1099","Search%_", "Recherche%_","%_\\"]){const rows=(await searchCompany(reader,{q,type:"ACCOUNT"},"fr-CA")).rows;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:accountId,kind:"ACCOUNT",reference:"1099",name:'Recherche%_\\ Nord',status:"INACTIVE",date:null,amountCents:null,href:`/c/${W.companyA}/grand-livre?compte=${accountId}`});}
 expect((await searchCompany(reader,{q:"Recherche",type:"ACCOUNT"},"en")).rows[0]?.name).toBe('Search%_\\ North');
 expect((await searchCompany(reader,{type:"ACCOUNT",statut:"INACTIVE"},"en")).rows.map(row=>row.id)).toContain(accountId);
 expect((await searchCompany(reader,{q:"1099",type:"ACCOUNT",du:"2026-01-01"},"en")).rows).toEqual([]);expect((await searchCompany(reader,{q:"1099",type:"ACCOUNT",montant:"0"},"en")).rows).toEqual([]);
 expect((await searchCompany(reader,{type:"ACCOUNT",q:"PRIVATE-ACCOUNT-DESCRIPTION"},"en")).rows).toEqual([]);
 const ledger=await getAccountLedger(reader,{accountId,from:"2026-06-01",to:"2026-06-30"});expect(ledger.lineCount).toBe(2);expect(ledger.closingCents).toBe(0n);
});
it("finds manual/opening entries and their reversals by exact number, date, amount and current reversal state",async()=>{
 const rows=(await searchCompany(reader,{type:"JOURNAL_ENTRY"},"en")).rows;expect(new Set(rows.map(row=>row.id))).toEqual(new Set([manual,opening,reversal,large]));
 for(const [id,source,status] of [[manual,"MANUAL","REVERSED"],[opening,"OPENING_BALANCE","POSTED"],[reversal,"REVERSAL","POSTED"]] as const){const entry=(await getEntry(reader,id))!;const found=(await searchCompany(reader,{type:"JOURNAL_ENTRY",q:entry.numberLabel},"en")).rows[0];expect(found).toMatchObject({id,reference:entry.numberLabel,name:null,entrySource:source,status,amountCents:entry.totalCents,href:`/c/${W.companyA}/journal/${id}`});}
 expect((await searchCompany(reader,{type:"JOURNAL_ENTRY",q:"GL-002",du:"2026-06-01",au:"2026-06-01",statut:"REVERSED",montant:"123,45"},"fr-CA")).rows.map(row=>row.id)).toEqual([manual]);
 expect((await searchCompany(reader,{type:"JOURNAL_ENTRY",du:"2026-06-02",au:"2026-06-02",statut:"POSTED",montant:"123.45"},"en")).rows.map(row=>row.id)).toEqual([reversal]);
});
it("excludes document/payment journals and private memo, line and contact text without financial writes",async()=>{
 const before=(await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;expect(excluded.length).toBeGreaterThanOrEqual(6);
 const rows=(await searchCompany(reader,{type:"JOURNAL_ENTRY"},"en")).rows;expect(rows.every(row=>!excluded.includes(row.id))).toBe(true);
 for(const q of ["PRIVATE","Client Fictif","Fournisseur Fictif"]){expect((await searchCompany(reader,{type:"JOURNAL_ENTRY",q},"en")).rows).toEqual([]);}
 const text=JSON.stringify(rows,(_,v)=>typeof v==="bigint"?v.toString():v);for(const secret of ["PRIVATE","memo","description","contactId","sourceId"])expect(text).not.toContain(secret);
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(before);
});
it("keeps totals above number precision exact and formats padded journal numbers without truncation",async()=>{
 for(const locale of ["fr-CA","en"] as const){const result=await searchCompany(reader,{type:"JOURNAL_ENTRY",q:"90 071 992 547 409,93 $",montant:"90071992547409.93"},locale);expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({id:large,amountCents:largeCents});}
 expect((await getEntry(reader,large))!.totalCents).toBe(largeCents);
 // Padding is a minimum width: sequence numbers beyond it retain every digit.
 await db.query("UPDATE number_sequence SET next_value=1001 WHERE company_id=$1 AND key='JOURNAL_ENTRY'",[W.companyA]);const entry=await post("2026-06-04",1n);expect((await searchCompany(reader,{type:"JOURNAL_ENTRY",q:"GL-1001"},"en")).rows[0]?.id).toBe(entry.id);
});
it("paginates accounting entries with stable ordering and no duplicate rows",async()=>{
 for(let i=0;i<54;i++)await post("2026-07-01",1n);
 const filters={type:"JOURNAL_ENTRY",du:"2026-07-01",au:"2026-07-01",montant:"0.01"};const one=await searchCompany(reader,filters,"en"),two=await searchCompany(reader,{...filters,page:"2"},"en");expect(one.rows).toHaveLength(50);expect(one.hasMore).toBe(true);expect(two.rows).toHaveLength(4);expect(two.hasMore).toBe(false);expect(new Set([...one.rows,...two.rows].map(row=>row.id)).size).toBe(54);expect((await searchCompany(reader,filters,"en")).rows.map(row=>row.id)).toEqual(one.rows.map(row=>row.id));
});
it("requires accounting independently and isolates companies and revoked memberships",async()=>{
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",contacts:"none",catalog:"none",sales:"none",taxes:"none"})]);expect((await searchCompany(reader,{type:"ACCOUNT",q:"1099"},"en")).rows).toHaveLength(1);expect((await searchCompany(reader,{type:"JOURNAL_ENTRY",q:"GL-002"},"en")).rows[0]?.id).toBe(manual);await expect(updateAccount(reader,accountId,{nameFr:"Forbidden"})).rejects.toMatchObject({key:"forbidden"});
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"none",contacts:"read",catalog:"read",sales:"read",taxes:"read"})]);for(const type of ["ACCOUNT","JOURNAL_ENTRY"])expect((await searchCompany(reader,{type},"en")).rows).toEqual([]);
 const foreign={userId:W.userOwnerB,companyId:W.companyB};expect((await searchCompany(foreign,{type:"JOURNAL_ENTRY"},"en")).rows).toEqual([]);expect((await searchCompany(foreign,{type:"ACCOUNT",q:"1099"},"en")).rows).toEqual([]);await expect(searchCompany({...reader,companyId:W.companyB},{type:"ACCOUNT"},"en")).rejects.toThrow();
 await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(searchCompany(reader,{type:"ACCOUNT"},"en")).rejects.toThrow();
});
