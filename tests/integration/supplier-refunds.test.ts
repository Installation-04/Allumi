import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll,beforeAll,expect,it } from "vitest";
import { getDraft,getBill,postBill,saveDraft,saveCreditDraft,getCreditDraft,postCreditNote,getSupplierCreditOpenCents,voidCreditNote,applySupplierCredit,unapplySupplierCredit } from "@/modules/purchases";
import { recordDisbursement,recordSupplierRefund,voidSupplierRefund,getSupplierRefund,listSupplierRefunds,listSupplierRefundAccounts,listSupplierRefundOrigins,listCreditSupplierRefunds,listReceipts,listCustomerRefunds } from "@/modules/payments";
import { getPayablesAging,getSupplierStatement,getTaxSummary } from "@/modules/reports";
import { searchCompany } from "@/modules/search";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader},other={userId:W.userOwnerB,companyId:W.companyB};
let db:pg.Client;
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'PAYMENT_SENT',1,'D-',5)",[W.companyA]);});
afterAll(async()=>{await db?.end();});
async function bill(){const id=await saveDraft(actor,{contactId:W.supplier,documentDate:"2026-01-01",dueDate:"2026-02-01",lines:[{description:"Supplies",quantity:"1",unitPrice:"100",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});await postBill(actor,id,(await getDraft(actor,id))!.revision,"2026-01-01");return id;}
async function credit(){const source=await bill();await recordDisbursement(actor,{billId:source,amountCents:"11498",expectedOpenCents:"11498",date:"2026-01-02",accountId:W.bank,method:"EFT"});const document=(await getBill(actor,source))!;const id=await saveCreditDraft(actor,source,{documentDate:"2026-01-03",memo:"Private reason",lines:[{lineId:document.lines[0]!.id,amount:"100"}]});await postCreditNote(actor,id,(await getCreditDraft(actor,id))!.revision,"2026-01-03",{applicationMode:"UNAPPLIED"});return id;}
const input=(supplierCreditId:string,values:Record<string,string|undefined>={})=>({supplierCreditId,amountCents:"2874",expectedOpenCents:"11498",date:"2026-01-05",accountId:W.bank,method:"EFT",reference:"Refund %_\\ reference",memo:"Private receipt note",...values});

it("posts exact cash/AP entries without recalculating taxes, reverses once and preserves dated reports",async()=>{
 const id=await credit(),before=await getPayablesAging(reader,{asOf:"2026-01-05"}),taxes=await getTaxSummary(actor,{from:"2026-01-01",to:"2026-01-31"});
 const payment=await recordSupplierRefund(actor,input(id));expect(payment.number).toMatch(/^E-/);expect(await getSupplierCreditOpenCents(reader,id)).toBe(8624n);
 const detail=(await getSupplierRefund(reader,payment.id))!;expect(detail).toMatchObject({direction:"RECEIVED",ledger:"PAYABLE",amountCents:2874n,status:"POSTED"});
 const lines=(await db.query("SELECT account_id,debit_cents::text AS debit,credit_cents::text AS credit,contact_id FROM journal_line WHERE company_id=$1 AND entry_id=$2 ORDER BY line_no",[W.companyA,detail.journalEntryId])).rows;
 expect(lines).toEqual([{account_id:W.bank,debit:"2874",credit:"0",contact_id:null},{account_id:W.payable,debit:"0",credit:"2874",contact_id:W.supplier}]);
 const after=await getPayablesAging(reader,{asOf:"2026-01-05"});expect(after.totalCents-before.totalCents).toBe(2874n);expect(after.differenceCents).toBe(0n);
 expect((await getSupplierStatement(actor,{contactId:W.supplier,from:"2026-01-01",to:"2026-01-31"})).rows.some(row=>row.kind==="REFUND" && row.sourceId===payment.id && row.creditCents===2874n)).toBe(true);
 await expect(voidCreditNote(actor,id,"2026-01-06","Correction")).rejects.toMatchObject({key:"purchases.creditVoidLinked"});
 await voidSupplierRefund(actor,payment.id,{date:"2026-01-07",reason:"Correction"});const voided=(await getSupplierRefund(reader,payment.id))!;await voidSupplierRefund(actor,payment.id,{date:"2026-01-08",reason:"Repeated"});
 expect((await getSupplierRefund(reader,payment.id))!.voidEntryId).toBe(voided.voidEntryId);expect((await getSupplierRefund(reader,payment.id))!.voidDate).toBe("2026-01-07");
 expect(await getSupplierCreditOpenCents(reader,id)).toBe(11498n);expect((await listSupplierRefundOrigins(reader,payment.id)).origins[0]).toMatchObject({creditId:id,amountCents:2874n,unappliedDate:"2026-01-07"});
 expect((await getPayablesAging(reader,{asOf:"2026-01-06"})).totalCents).toBe(after.totalCents);expect((await getPayablesAging(reader,{asOf:"2026-01-07"})).totalCents).toBe(before.totalCents);
 expect((await getTaxSummary(actor,{from:"2026-01-01",to:"2026-01-31"})).taxes).toEqual(taxes.taxes);
 await voidCreditNote(actor,id,"2026-01-08","Correction");expect((await getPayablesAging(reader,{asOf:"2026-01-08"})).differenceCents).toBe(0n);
 expect((await listReceipts(reader)).receipts.some(p=>p.id===payment.id)).toBe(false);expect((await listCustomerRefunds(actor)).refunds.some(p=>p.id===payment.id)).toBe(false);
});

it("serializes two refunds or a refund versus application without overspending a credit",async()=>{
 const id=await credit();const results=await Promise.allSettled([1,2].map(()=>recordSupplierRefund(actor,input(id,{amountCents:"8000"}))));expect(results.filter(p=>p.status==="fulfilled")).toHaveLength(1);expect(await getSupplierCreditOpenCents(reader,id)).toBe(3498n);
 const id2=await credit(),target=await bill();const competing=await Promise.allSettled([recordSupplierRefund(actor,input(id2,{amountCents:"8000"})),applySupplierCredit(actor,{supplierCreditId:id2,billId:target,amountCents:"8000",expectedCreditCents:"11498",expectedBillCents:"11498",date:"2026-01-05"})]);expect(competing.filter(p=>p.status==="fulfilled")).toHaveLength(1);expect(await getSupplierCreditOpenCents(reader,id2)).toBe(3498n);
});

it("refuses stale balances and dates before posting, future dates, releases and later credit movements",async()=>{
 const id=await credit();for(const values of [{date:"2026-01-02"},{date:"2999-01-01"},{date:"2026-02-30"},{amountCents:"0"},{amountCents:"11499"},{expectedOpenCents:"100"}])await expect(recordSupplierRefund(actor,input(id,values))).rejects.toThrow();
 const target=await bill();const a=await applySupplierCredit(actor,{supplierCreditId:id,billId:target,amountCents:"1000",expectedCreditCents:"11498",expectedBillCents:"11498",date:"2026-01-06"});await unapplySupplierCredit(actor,a.id,{date:"2026-01-07"});
 await expect(recordSupplierRefund(actor,input(id))).rejects.toMatchObject({key:"supplierRefunds.dateBeforeMovement"});
 const refund=await recordSupplierRefund(actor,input(id,{date:"2026-01-08"}));await expect(voidSupplierRefund(actor,refund.id,{date:"2026-01-07",reason:"Correction"})).rejects.toThrow();await expect(voidSupplierRefund(actor,refund.id,{date:"2999-01-01",reason:"Correction"})).rejects.toMatchObject({key:"supplierRefunds.futureDate"});await voidSupplierRefund(actor,refund.id,{date:"2026-01-09",reason:"Correction"});
 await expect(recordSupplierRefund(actor,input(id,{date:"2026-01-08"}))).rejects.toMatchObject({key:"supplierRefunds.dateBeforeMovement"});
});

it("rolls back journal and numbers on a locked period, invalid account or insufficient availability",async()=>{
 const id=await credit();const counters=()=>db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA]);const before=(await counters()).rows;
 for(const accountId of [W.expenses,W.undeposited,W.bankB,randomUUID()])await expect(recordSupplierRefund(actor,input(id,{accountId}))).rejects.toMatchObject({key:"supplierRefunds.account"});
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=1",[W.companyA,W.userOwnerA]);try{await expect(recordSupplierRefund(actor,input(id))).rejects.toThrow();}finally{await db.query("UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE company_id=$1 AND period_number=1",[W.companyA]);}
 expect((await counters()).rows).toEqual(before);expect(await getSupplierCreditOpenCents(reader,id)).toBe(11498n);
});

it("enforces read/write and tenant boundaries without Contacts, Taxes or Sales directory access",async()=>{
 const id=await credit();await expect(recordSupplierRefund(reader,input(id))).rejects.toMatchObject({key:"forbidden"});await expect(recordSupplierRefund(other,input(id))).rejects.toThrow();
 const accountant={...actor,userId:W.userAccountant};await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant,JSON.stringify({accounting:"write",contacts:"none",taxes:"none",sales:"none"})]);
 const p=await recordSupplierRefund(accountant,input(id));expect((await getSupplierRefund(accountant,p.id))!.supplier).toBeTruthy();expect((await listSupplierRefunds(accountant,1,{q:"%_\\"})).refunds.some(row=>row.id===p.id)).toBe(true);expect(await getSupplierRefund(other,p.id)).toBeNull();await expect(voidSupplierRefund(reader,p.id,{date:"2026-01-06",reason:"Correction"})).rejects.toMatchObject({key:"forbidden"});
 const search=await searchCompany(accountant,{q:p.number,type:"SUPPLIER_REFUND"},"en");expect(search.rows.find(row=>row.id===p.id)?.href).toBe(`/c/${W.companyA}/remboursements-fournisseurs/${p.id}`);
 await voidSupplierRefund(accountant,p.id,{date:"2026-01-06",reason:"Correction"});expect((await listCreditSupplierRefunds(accountant,id)).payments[0]?.unappliedDate).toBe("2026-01-06");
});

it("accepts a card refund as a debit reducing the card liability and excludes inactive accounts",async()=>{
 const id=await credit(),card=randomUUID();await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,'2055','Carte','Card','LIABILITY','CREDIT_CARD',now())",[card,W.companyA]);
 expect((await listSupplierRefundAccounts(reader)).some(a=>a.id===card)).toBe(true);const p=await recordSupplierRefund(actor,input(id,{accountId:card,method:"CREDIT_CARD"}));expect((await getSupplierRefund(reader,p.id))!.account.code).toBe("2055");
 await db.query("UPDATE account SET is_active=false WHERE company_id=$1 AND id=$2",[W.companyA,card]);await expect(recordSupplierRefund(actor,input(id,{accountId:card,expectedOpenCents:"8624"}))).rejects.toMatchObject({key:"supplierRefunds.account"});await voidSupplierRefund(actor,p.id,{date:"2026-01-06",reason:"Correction"});
});


it("bounds refund history, preserves literal filters and keeps inactive allocation history visible",async()=>{
 const id=await credit(),reference=`Bound-${randomUUID()}`;
 for(let i=0;i<26;i++)await recordSupplierRefund(actor,input(id,{amountCents:"1",expectedOpenCents:String(11498-i),reference}));
 const first=await listSupplierRefunds(reader,1,{q:reference}),second=await listSupplierRefunds(reader,2,{q:reference});
 expect(first.total).toBe(26);expect(first.refunds).toHaveLength(25);expect(second.refunds).toHaveLength(1);
 const history=await listCreditSupplierRefunds(reader,id);expect(history.payments).toHaveLength(25);expect(history.hasMore).toBe(true);
 const payment=first.refunds[0]!;await voidSupplierRefund(actor,payment.id,{date:"2026-01-06",reason:"Correction"});
 expect((await listSupplierRefunds(reader,1,{q:reference,status:"VOID",from:"2026-01-05",to:"2026-01-05"})).total).toBe(1);
 expect((await listSupplierRefundOrigins(reader,payment.id)).origins[0]?.unappliedDate).toBe("2026-01-06");
});

it("rolls back allocation releases and reversal numbers when voiding in a closed period",async()=>{
 const id=await credit(),p=await recordSupplierRefund(actor,input(id));
 const before=(await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows;
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=1",[W.companyA,W.userOwnerA]);
 try{await expect(voidSupplierRefund(actor,p.id,{date:"2026-01-06",reason:"Correction"})).rejects.toThrow();}finally{await db.query("UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE company_id=$1 AND period_number=1",[W.companyA]);}
 expect((await getSupplierRefund(reader,p.id))!.status).toBe("POSTED");expect((await listSupplierRefundOrigins(reader,p.id)).origins[0]?.unappliedDate).toBeNull();expect(await getSupplierCreditOpenCents(reader,id)).toBe(8624n);
 expect((await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows).toEqual(before);
});

it("serializes refund recording against credit cancellation with no orphan entry",async()=>{
 const id=await credit();const results=await Promise.allSettled([recordSupplierRefund(actor,input(id)),voidCreditNote(actor,id,"2026-01-05","Correction")]);
 expect(results.filter(row=>row.status==="fulfilled")).toHaveLength(1);expect(results.filter(row=>row.status==="rejected")).toHaveLength(1);
 expect((await getPayablesAging(reader,{asOf:"2026-01-05"})).differenceCents).toBe(0n);
});
