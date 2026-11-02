import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { reverseEntry } from "@/modules/ledger";
import { getAccountLedger,getLedgerExport,listLedgerContacts,findLedgerContact } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
const range={accountId:W.bank,from:"2026-06-01",to:"2026-06-30",contactId:W.customer};
let db:pg.Client;
const foreign=randomUUID();
const post=async(date:string,amount:bigint,contactId?:string)=>{
 const id=randomUUID();await db.query("BEGIN");
 try{
  const seq=await db.query("UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=$1 AND key='JOURNAL_ENTRY' RETURNING next_value-1 AS n",[W.companyA]);
  await db.query("INSERT INTO journal_entry(id,company_id,entry_number,entry_date,fiscal_period_id,source_type,created_by_id,memo) SELECT $1,$2,$3,$4,id,'MANUAL',$5,'Contact fixture' FROM fiscal_period WHERE company_id=$2 AND $4::date BETWEEN start_date AND end_date",[id,W.companyA,seq.rows[0].n,date,W.userOwnerA]);
  await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,contact_id,debit_cents,credit_cents,entry_date) VALUES(gen_random_uuid(),$1,$2,1,$3,$4,$5,0,$6),(gen_random_uuid(),$1,$2,2,$7,null,0,$5,$6)",[W.companyA,id,W.bank,contactId??null,amount.toString(),date,W.sales]);
  await db.query("COMMIT");return {id};
 }catch(e){await db.query("ROLLBACK");throw e;}
};
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 await db.query("INSERT INTO contact(id,company_id,display_name,is_customer,updated_at) VALUES($1,$2,'Foreign',true,now())",[foreign,W.companyB]);
 const first=await post("2026-05-31",10000n,W.customer);
 for(let i=0;i<105;i++)await post("2026-06-01",100n,W.customer);
 await post("2026-06-01",30000n,W.supplier);await post("2026-06-01",40000n);
 await reverseEntry(actor,first.id,{date:"2026-06-20",memo:"Dated reversal"});
 await post("2026-07-01",90000n,W.customer);
});
afterAll(async()=>{await db?.end();});
it("filters openings, totals and running balances across pages, including a dated reversal",async()=>{
 const first=await getAccountLedger(actor,range),second=await getAccountLedger(actor,{...range,page:2});
 expect(first).toMatchObject({openingCents:10000n,closingCents:10500n,debitCents:10500n,creditCents:10000n,lineCount:106,pageCount:2});
 expect(first.rows).toHaveLength(100);expect(second.rows).toHaveLength(6);
 expect(first.rows.at(-1)?.balanceCents).toBe(20000n);expect(second.rows[0]?.balanceCents).toBe(20100n);expect(second.rows.at(-1)?.balanceCents).toBe(10500n);
 expect(second.rows.at(-1)).toMatchObject({reversed:true,date:"2026-06-20"});
 const normal=await getAccountLedger(actor,{...range,contactId:undefined});expect(normal.closingCents).toBe(80500n);expect(normal.lineCount).toBe(108);
 expect((await getAccountLedger(actor,{...range,contactId:W.supplier})).closingCents).toBe(30000n);
});
it("exports the same contact over all pages and excludes counterpart lines without that contact",async()=>{
 const one=await getLedgerExport(actor,range),all=await getLedgerExport(actor,{...range,accountId:null});
 expect(one[0]).toMatchObject({openingCents:10000n,closingCents:10500n});expect(one[0]?.rows).toHaveLength(106);
 expect(all.map(r=>r.account.id)).toEqual([W.bank]);
 await expect(getLedgerExport(actor,range,{maxLines:105})).rejects.toMatchObject({key:"reports.tooManyLines"});
 expect((await getLedgerExport(actor,{...range,contactId:W.supplier},{maxLines:1}))[0]?.rows).toHaveLength(1);
 const future=await getLedgerExport(actor,{...range,from:"2026-08-01",to:"2026-08-31",accountId:null});expect(future[0]).toMatchObject({openingCents:100500n,closingCents:100500n,rows:[]});
});
it("keeps historical inactive contacts and requires contact permissions and exposes only minimal names",async()=>{
 await db.query("UPDATE contact SET is_active=false WHERE id=$1",[W.customer]);
 const reader={...actor,userId:W.userReader};await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",contacts:"read",sales:"none",taxes:"none"})]);
 const c=await findLedgerContact(reader,W.customer);expect(c?.isActive).toBe(false);expect(Object.keys(c!).sort()).toEqual(["displayName","id","isActive"]);
 expect((await listLedgerContacts(reader)).contacts.map(c=>c.id)).toContain(W.customer);
 expect((await getAccountLedger(reader,range)).closingCents).toBe(10500n);
 const literal=await listLedgerContacts(reader,"%");expect(literal.contacts).toEqual([]);
 expect(await findLedgerContact(reader,foreign)).toBeNull();
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",contacts:"none"})]);
 await expect(getAccountLedger(reader,range)).rejects.toThrow();await expect(getLedgerExport(reader,range)).rejects.toThrow();await expect(listLedgerContacts(reader)).rejects.toThrow();
 expect((await getAccountLedger(reader,{...range,contactId:undefined})).closingCents).toBe(80500n);
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"none"})]);await expect(listLedgerContacts(reader)).rejects.toThrow();await expect(getAccountLedger(reader,range)).rejects.toThrow();
});
it("rejects malformed, missing and foreign contacts in both services and isolates companies",async()=>{
 for(const id of ["bad",randomUUID(),foreign]){
  await expect(getAccountLedger(actor,{...range,contactId:id})).rejects.toMatchObject({key:"reports.contact"});await expect(getLedgerExport(actor,{...range,contactId:id})).rejects.toMatchObject({key:"reports.contact"});
 }
 await expect(getAccountLedger({userId:W.userOwnerB,companyId:W.companyA},range)).rejects.toThrow();
 expect((await listLedgerContacts({userId:W.userOwnerB,companyId:W.companyB})).contacts).toEqual([]);
});
it("bounds the selector and searches beyond its first page with literal matching",async()=>{
 for(let i=0;i<101;i++){
  const id=randomUUID();await db.query("INSERT INTO contact(id,company_id,display_name,is_customer,updated_at) VALUES($1,$2,$3,true,now())",[id,W.companyA,`Bound ${String(i).padStart(3,"0")}`]);await post("2026-06-02",1n,id);
 }
 const needle=randomUUID();await db.query("INSERT INTO contact(id,company_id,display_name,is_customer,updated_at) VALUES($1,$2,'ZZneedle%_lookup',true,now())",[needle,W.companyA]);await post("2026-06-02",1n,needle);
 const limited=await listLedgerContacts(actor);expect(limited.contacts).toHaveLength(100);expect(limited.hasMore).toBe(true);expect(limited.contacts.map(c=>c.id)).not.toContain(needle);
 expect((await listLedgerContacts(actor,"%_")).contacts.map(c=>c.id)).toEqual([needle]);expect((await findLedgerContact(actor,needle))?.id).toBe(needle);
});
