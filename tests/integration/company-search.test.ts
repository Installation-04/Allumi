import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { searchCompany } from "@/modules/search";
import { saveDraft, getDraft, postInvoice } from "@/modules/sales";
import { saveDraft as saveBill, getDraft as getBill, postBill } from "@/modules/purchases";
import { getItem, listItems } from "@/modules/taxes";
import { owner } from "./helpers";
import { seedWorld, W, setContext, asOwnerA } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA}, reader={...actor,userId:W.userReader};
let db:pg.Client,invoice:string,bill:string,draft:string;
const payments: {id:string;kind:string;entry:string}[]=[];
beforeAll(async()=>{
  db=await owner();await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5)",[W.companyA]);
  const lines=[{description:"Private line",quantity:"1",unitPrice:"123.45",accountId:W.sales,taxCodeId:W.taxCodeExempt}];
  invoice=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-15",dueDate:"2026-06-30",reference:"SEARCH%_\\literal",memo:"Hidden memo",lines});
  await postInvoice(actor,invoice,(await getDraft(actor,invoice))!.revision,"2026-06-15");
  draft=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-16",dueDate:"2026-06-30",reference:"DRAFT-FIND",lines});
  bill=await saveBill(actor,{contactId:W.supplier,documentDate:"2026-06-16",dueDate:"2026-06-30",supplierReference:"EXT-REF-778",lines:[{...lines[0]!,accountId:W.expenses}]});
  await postBill(actor,bill,(await getBill(actor,bill))!.revision,"2026-06-16");
  for (const [index, [ledger,direction,kind]] of ([['RECEIVABLE','RECEIVED','RECEIPT'],['RECEIVABLE','SENT','REFUND'],['PAYABLE','SENT','DISBURSEMENT'],['PAYABLE','RECEIVED','SUPPLIER_REFUND']] as const).entries()) {
    const id=randomUUID(),entry=randomUUID(),received=direction==='RECEIVED',contact=ledger==='PAYABLE'?W.supplier:W.customer;
    await db.query('BEGIN');
    try {
      await setContext(db,asOwnerA);
      await db.query("INSERT INTO journal_entry(id,company_id,entry_number,entry_date,fiscal_period_id,source_type,source_id,created_by_id) SELECT $1,$2,$3,'2026-06-17',id,'PAYMENT',$4,$5 FROM fiscal_period WHERE company_id=$2 AND '2026-06-17'::date BETWEEN start_date AND end_date",[entry,W.companyA,1000+index,id,W.userOwnerA]);
      await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date) VALUES(gen_random_uuid(),$1,$2,1,$3,$4,$5,'2026-06-17')",[W.companyA,entry,W.bank,received?101:0,received?0:101]);
      await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,contact_id,entry_date) VALUES(gen_random_uuid(),$1,$2,2,$3,$4,$5,$6,'2026-06-17')",[W.companyA,entry,ledger==='PAYABLE'?W.payable:W.receivable,received?0:101,received?101:0,contact]);
      await db.query("INSERT INTO payment(id,company_id,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,reference,updated_at) VALUES($1,$2,$3::payment_direction,$4::payment_ledger,$5,'2026-06-17',101,$6,'EFT',$7,$8,'PAYMENT-NEEDLE',now())",[id,W.companyA,direction,ledger,contact,W.bank,entry,W.userOwnerA]);
      await db.query('COMMIT');payments.push({id,kind,entry});
    } catch(error) {await db.query('ROLLBACK');throw error;}
  }
  await db.query("UPDATE contact SET display_name='Current secret identity',email='private-search@example.test',updated_at=now() WHERE id=$1",[W.customer]);
  await db.query("INSERT INTO contact(id,company_id,display_name,is_customer,updated_at) VALUES($1,$2,'Foreign needle',true,now())",[randomUUID(),W.companyB]);
  await db.query("INSERT INTO item(id,company_id,code,name,updated_at) VALUES($1,$2,'SKU-SEARCH','Synthetic product',now())",[randomUUID(),W.companyA]);
});
afterAll(async()=>{await db?.end();});
it("finds actual documents by numbers, references, exact cents and dates with canonical links",async()=>{
  const result=await searchCompany(reader,{q:"F-00001"},"en");
  expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({id:invoice,kind:"INVOICE",amountCents:12345n,name:"Client Fictif",href:`/c/${W.companyA}/factures/validees/${invoice}`});
  expect((await searchCompany(reader,{q:"EXT-REF-778"},"en")).rows[0]?.id).toBe(bill);
  expect((await searchCompany(reader,{q:"123,45",type:"BILL",du:"2026-06-16",au:"2026-06-16",statut:"POSTED"},"fr-CA")).rows.map(r=>r.id)).toEqual([bill]);
  expect((await searchCompany(reader,{q:"2026-06-15"},"en")).rows.map(r=>r.id)).toEqual([invoice]);
  expect((await searchCompany(reader,{q:"DRAFT-FIND"},"en")).rows[0]?.href).toBe(`/c/${W.companyA}/factures/${draft}`);
  expect((await searchCompany(reader,{q:"Hidden memo"},"en")).rows).toEqual([]);
});
it("treats LIKE wildcards literally and isolates companies, including membership revocation",async()=>{
  expect((await searchCompany(reader,{q:"%_\\"},"en")).rows.map(r=>r.id)).toEqual([invoice]);
  expect((await searchCompany(reader,{q:"Foreign needle"},"en")).rows).toEqual([]);
  await expect(searchCompany({...actor,companyId:W.companyB},{q:"Foreign"},"en")).rejects.toThrow();
  await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant]);
  await expect(searchCompany({...actor,userId:W.userAccountant},{q:"F-00001"},"en")).rejects.toThrow();
});
it("finds each payment kind and uses the appropriate authorized detail destination",async()=>{
  const result=await searchCompany(reader,{q:"PAYMENT-NEEDLE",montant:"1.01"},"en");
  expect(result.rows).toHaveLength(4);
  for(const payment of payments) {
    const route=payment.kind==='RECEIPT'?`encaissements/${payment.id}`:payment.kind==='REFUND'?`remboursements/${payment.id}`:payment.kind==='DISBURSEMENT'?`decaissements/${payment.id}`:`journal/${payment.entry}`;
    expect(result.rows.find(row=>row.id===payment.id)).toMatchObject({kind:payment.kind,amountCents:101n,href:`/c/${W.companyA}/${route}`});
  }
});
it("applies modular permissions without exposing current contact identities through documents",async()=>{
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({contacts:"none",catalog:"none",sales:"read",accounting:"none"})]);
  expect((await searchCompany(reader,{q:"Current secret identity"},"en")).rows).toEqual([]);
  expect((await searchCompany(reader,{q:"private-search@example.test"},"en")).rows).toEqual([]);
  expect((await searchCompany(reader,{q:"F-00001"},"en")).rows[0]?.name).toBe("Client Fictif");
  expect((await searchCompany(reader,{q:"DRAFT-FIND"},"en")).rows[0]?.name).toBeNull();
  expect((await searchCompany(reader,{q:"EXT-REF-778"},"en")).rows).toEqual([]);
  expect((await searchCompany(reader,{q:"PAYMENT-NEEDLE"},"en")).rows).toEqual([]);
  expect((await searchCompany(reader,{q:"SKU-SEARCH"},"en")).rows).toEqual([]);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({contacts:"read",catalog:"read",sales:"none",accounting:"read"})]);
  expect((await searchCompany(reader,{q:"F-00001"},"en")).rows).toEqual([]);
  expect((await searchCompany(reader,{q:"EXT-REF-778"},"en")).rows[0]?.id).toBe(bill);
  const item=(await searchCompany(reader,{q:"SKU-SEARCH"},"en")).rows[0]!;expect(item.kind).toBe("ITEM");
  await db.query("UPDATE membership SET module_access=module_access || '{\"taxes\":\"none\"}'::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
  expect((await getItem(reader,item.id))?.name).toBe("Synthetic product");
  expect((await listItems(reader,"SKU-SEARCH")).items).toHaveLength(1);
  expect((await searchCompany(reader,{q:"PAYMENT-NEEDLE"},"en")).rows.map(row=>row.kind).sort()).toEqual(["DISBURSEMENT","SUPPLIER_REFUND"]);
});
it("paginates in stable order and preserves archived contacts without loading an unbounded result set",async()=>{
  for(let i=0;i<54;i++)await db.query("INSERT INTO contact(id,company_id,display_name,is_active,is_customer,updated_at) VALUES($1,$2,$3,$4,true,now())",[randomUUID(),W.companyA,`Paging needle ${i}`,i!==0]);
  const one=await searchCompany(reader,{q:"Paging needle"},"en"),two=await searchCompany(reader,{q:"Paging needle",page:"2"},"en");
  expect(one.rows).toHaveLength(50);expect(one.hasMore).toBe(true);expect(two.rows).toHaveLength(4);expect(two.hasMore).toBe(false);
  expect(new Set([...one.rows,...two.rows].map(r=>r.id)).size).toBe(54);
  expect((await searchCompany(reader,{q:"Paging needle",statut:"ARCHIVED"},"en")).rows).toHaveLength(1);
  expect((await searchCompany(reader,{},"en")).rows).toEqual([]);
  expect((await searchCompany(reader,{q:"Paging needle",du:"2026-01-01"},"en")).rows).toEqual([]);
});
