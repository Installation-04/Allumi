import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { postManualEntry,reverseEntry } from "@/modules/ledger";
import { getIncomeComparison,getIncomeStatement } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
const periods={current:{from:"2026-07-01",to:"2026-07-31"},reference:{from:"2026-06-01",to:"2026-06-30"}};
let db:pg.Client,otherRevenue:string,otherExpense:string;
const post=(date:string,debit:string,credit:string,amount:bigint)=>postManualEntry(actor,{date,kind:"MANUAL",memo:"Comparison fixture",lines:[{accountId:debit,debitCents:amount,creditCents:0n},{accountId:credit,debitCents:0n,creditCents:amount}]});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 otherRevenue=randomUUID();otherExpense=randomUUID();
 for(const [id,code,type,subtype] of [[otherRevenue,"4900","REVENUE","OTHER_REVENUE"],[otherExpense,"7000","EXPENSE","OTHER_EXPENSE"]])await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,$3,'Comparatif','Comparison',$4::account_type,$5::account_subtype,now())",[id,W.companyA,code,type,subtype]);
 await post("2026-06-01",W.bank,W.sales,10000n);await post("2026-07-31",W.bank,W.sales,15000n);
 const expense=await post("2026-06-30",W.expenses,W.bank,2000n);await post("2026-07-01",W.expenses,W.bank,3000n);
 await reverseEntry(actor,expense.id,{date:"2026-07-02",memo:"Correct expense"});
 await post("2026-06-15",W.bank,otherRevenue,500n);await post("2026-07-15",otherExpense,W.bank,1000n);await post("2026-05-15",W.expenses,W.bank,500n);
});
afterAll(async()=>{await db?.end();});
it("aligns accounts by identity, includes period boundaries and handles dated reversals",async()=>{
 const r=await getIncomeComparison(actor,periods);
 expect(r.sections.operatingRevenue.total).toMatchObject({currentCents:15000n,referenceCents:10000n,differenceCents:5000n,percentHundredths:5000n});
 expect(r.sections.operatingExpenses.total).toMatchObject({currentCents:1000n,referenceCents:2000n,differenceCents:-1000n,percentHundredths:-5000n});
 expect(r.sections.otherRevenue.lines[0]).toMatchObject({accountId:otherRevenue,currentCents:0n,referenceCents:500n,differenceCents:-500n,percentHundredths:-10000n});
 expect(r.sections.otherExpenses.lines[0]).toMatchObject({accountId:otherExpense,currentCents:1000n,referenceCents:0n,percentHundredths:null});
 expect(r.netIncome).toEqual({currentCents:13000n,referenceCents:8500n,differenceCents:4500n,percentHundredths:5294n});
 for(const key of ["current","reference"] as const)expect(r.netIncome[`${key}Cents`]).toBe((await getIncomeStatement(actor,periods[key])).statement.netIncomeCents);
});
it("allows matching or overlapping periods and avoids percentages for a loss or empty reference",async()=>{
 const same=await getIncomeComparison(actor,{current:periods.current,reference:periods.current});expect(same.netIncome.differenceCents).toBe(0n);expect(same.netIncome.percentHundredths).toBe(0n);
 const loss=await getIncomeComparison(actor,{current:periods.reference,reference:{from:"2026-05-01",to:"2026-05-31"}});expect(loss.netIncome).toMatchObject({referenceCents:-500n,currentCents:8500n,differenceCents:9000n,percentHundredths:null});
 const overlap=await getIncomeComparison(actor,{current:{from:"2026-06-01",to:"2026-07-31"},reference:periods.reference});expect(overlap.netIncome.currentCents).toBe(21500n);
 const empty=await getIncomeComparison(actor,{current:periods.current,reference:{from:"2025-12-01",to:"2025-12-31"}});expect(empty.netIncome.referenceCents).toBe(0n);expect(empty.netIncome.percentHundredths).toBeNull();
});
it("requires accounting only, respects revocation and refuses invalid or foreign contexts",async()=>{
 const reader={...actor,userId:W.userReader};await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",sales:"none",taxes:"none",contacts:"none"})]);
 expect((await getIncomeComparison(reader,periods)).netIncome.currentCents).toBe(13000n);
 expect((await getIncomeComparison({userId:W.userOwnerB,companyId:W.companyB},periods)).netIncome.currentCents).toBe(0n);
 await expect(getIncomeComparison({userId:W.userOwnerB,companyId:W.companyA},periods)).rejects.toThrow();
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"none"})]);await expect(getIncomeComparison(reader,periods)).rejects.toThrow();
 for(const invalid of [{from:"2026-02-30",to:"2026-06-01"},{from:"2026-07-01",to:"2026-06-01"}]){await expect(getIncomeComparison(actor,{...periods,current:invalid})).rejects.toMatchObject({key:"reports.period"});await expect(getIncomeComparison(actor,{...periods,reference:invalid})).rejects.toMatchObject({key:"reports.period"});}
});
it("retains inactive accounts and reads closed fiscal years without changing their results",async()=>{
 await db.query("UPDATE account SET is_active=false WHERE id=$1",[otherRevenue]);const before=await getIncomeComparison(actor,periods);
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);
 await db.query("UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);
 expect(await getIncomeComparison(actor,periods)).toEqual(before);
});
