import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { postManualEntry,reverseEntry } from "@/modules/ledger";
import { getCashMovements,getAccountLedger } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
const june={from:"2026-06-01",to:"2026-06-30"};
let db:pg.Client,cash:string,card:string;
const post=(date:string,debit:string,credit:string,amount:bigint)=>postManualEntry(actor,{date,kind:"MANUAL",memo:"Cash fixture",lines:[{accountId:debit,debitCents:amount,creditCents:0n},{accountId:credit,debitCents:0n,creditCents:amount}]});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 cash=randomUUID();card=randomUUID();
 for(const [id,code,type,subtype] of [[cash,"1020","ASSET","CASH"],[card,"2200","LIABILITY","CREDIT_CARD"]])await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,$3,'Trésorerie','Cash fixture',$4::account_type,$5::account_subtype,now())",[id,W.companyA,code,type,subtype]);
 await post("2026-05-31",W.bank,W.capital,100000n);await post("2026-05-31",W.undeposited,W.capital,6000n);
 const sale=await post("2026-06-01",W.bank,W.sales,20000n);await post("2026-06-02",W.expenses,W.bank,3000n);
 await post("2026-06-03",cash,W.bank,5000n);
 await postManualEntry(actor,{date:"2026-06-04",kind:"MANUAL",memo:"Transfer with fee",lines:[{accountId:cash,debitCents:4000n,creditCents:0n},{accountId:W.expenses,debitCents:500n,creditCents:0n},{accountId:W.bank,debitCents:0n,creditCents:4500n}]});
 await post("2026-06-05",W.bank,W.undeposited,6000n);await post("2026-06-06",W.expenses,card,7000n);
 await reverseEntry(actor,sale.id,{date:"2026-06-30",memo:"Sale correction"});
 await post("2026-07-01",W.bank,W.capital,999n);
});
afterAll(async()=>{await db?.end();});
it("separates pure transfers, retains mixed entries gross and controls posted balances",async()=>{
 const r=await getCashMovements(actor,june);
 expect(r.totals).toEqual({openingCents:100000n,incomingCents:30000n,outgoingCents:27500n,transferInCents:5000n,transferOutCents:5000n,closingCents:102500n,netCents:2500n,differenceCents:0n});
 expect(r.lineCount).toBe(8);expect(r.mixedEntryCount).toBe(1);
 expect(r.lines.filter(l=>l.kind==="transfer")).toHaveLength(2);expect(r.lines.filter(l=>l.kind==="mixed")).toHaveLength(2);
 expect(r.byAccount.map(a=>a.id)).not.toContain(W.undeposited);expect(r.byAccount.map(a=>a.id)).not.toContain(card);
 for(const a of r.byAccount){const ledger=await getAccountLedger(actor,{...june,accountId:a.id});expect(a.openingCents).toBe(ledger.openingCents);expect(a.closingCents).toBe(ledger.closingCents);}
 expect(r.lines.map(l=>l.date)).toEqual([...r.lines.map(l=>l.date)].sort());expect(r.lines.at(-1)?.date).toBe("2026-06-30");
});
it("keeps the transfer classification when viewing one account and exports the full scope",async()=>{
 const r=await getCashMovements(actor,{...june,accountId:W.bank.toUpperCase()});expect(r.selectedAccountId).toBe(W.bank);expect(r.byAccount).toHaveLength(1);expect(r.lineCount).toBe(6);
 expect(r.totals).toMatchObject({transferInCents:0n,transferOutCents:5000n,closingCents:93500n,differenceCents:0n});
 expect(r.lines.some(l=>l.kind==="transfer")).toBe(true);
 await expect(getCashMovements(actor,june,{allRows:true,maxLines:7})).rejects.toMatchObject({key:"reports.tooManyLines"});
 expect((await getCashMovements(actor,{...june,accountId:W.bank},{allRows:true,maxLines:6})).lines).toHaveLength(6);
});
it("retains empty periods and negative cash balances without moving them into liabilities",async()=>{
 const empty=await getCashMovements(actor,{from:"2025-12-01",to:"2025-12-31"});expect(empty.lineCount).toBe(0);expect(empty.totals.closingCents).toBe(0n);expect(empty.pageCount).toBe(1);
 await post("2026-08-01",W.expenses,cash,10000n);
 const negative=await getCashMovements(actor,{from:"2026-08-01",to:"2026-08-31",accountId:cash});expect(negative.totals).toMatchObject({openingCents:9000n,outgoingCents:10000n,closingCents:-1000n,differenceCents:0n});
});
it("paginates in journal order and exports every line while keeping whole-period totals",async()=>{
 for(let i=0;i<103;i++)await post("2026-07-02",W.bank,W.sales,BigInt(i+1));
 const range={from:"2026-07-02",to:"2026-07-31"};const one=await getCashMovements(actor,range),two=await getCashMovements(actor,{...range,page:2});
 expect(one.lines).toHaveLength(100);expect(two.lines).toHaveLength(3);expect(two.pageCount).toBe(2);expect(two.lineCount).toBe(103);expect(two.totals).toEqual(one.totals);
 const all=await getCashMovements(actor,{...range,page:99},{allRows:true});expect(all.lines.map(l=>l.id)).toEqual([...one.lines,...two.lines].map(l=>l.id));expect(all.lines.map(l=>l.debitCents)).toEqual(Array.from({length:103},(_,i)=>BigInt(i+1)));
 expect((await getCashMovements(actor,{...range,page:999})).page).toBe(2);expect((await getCashMovements(actor,{...range,page:NaN})).page).toBe(1);
});
it("requires accounting only, isolates companies and rejects noncash or foreign accounts",async()=>{
 const reader={...actor,userId:W.userReader};await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",contacts:"none",sales:"none",taxes:"none"})]);expect((await getCashMovements(reader,june)).totals.closingCents).toBe(102500n);
 expect((await getCashMovements({userId:W.userOwnerB,companyId:W.companyB},june)).totals.closingCents).toBe(0n);
 await expect(getCashMovements({userId:W.userOwnerB,companyId:W.companyA},june)).rejects.toThrow();
 for(const id of [W.bankB,W.undeposited,card,"invalid",randomUUID()])await expect(getCashMovements(actor,{...june,accountId:id})).rejects.toMatchObject({key:"reports.account"});
 for(const dates of [{from:"2026-02-30",to:"2026-03-01"},{from:"2026-07-01",to:"2026-06-01"}])await expect(getCashMovements(actor,dates)).rejects.toMatchObject({key:"reports.period"});
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"none"})]);await expect(getCashMovements(reader,june)).rejects.toThrow();
});
it("includes inactive cash accounts and reads locked and closed periods without changing them",async()=>{
 await db.query("UPDATE account SET is_active=false WHERE id=$1",[cash]);const before=await getCashMovements(actor,june);expect(before.byAccount.find(a=>a.id===cash)?.isActive).toBe(false);
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);await db.query("UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);
 expect(await getCashMovements(actor,june)).toEqual(before);
});
