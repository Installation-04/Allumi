import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { createFiscalYear,postManualEntry,reverseEntry } from "@/modules/ledger";
import { getBalanceComparison,getBalanceSheet,BALANCE_COMPARISON_FIGURES } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
const dates={asOf:"2027-01-31",referenceAsOf:"2026-12-31"};
let db:pg.Client,fixed:string,loan:string;
const post=(date:string,debit:string,credit:string,amount:bigint)=>postManualEntry(actor,{date,kind:"MANUAL",memo:"Balance comparison fixture",lines:[{accountId:debit,debitCents:amount,creditCents:0n},{accountId:credit,debitCents:0n,creditCents:amount}]});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 fixed=randomUUID();loan=randomUUID();
 for(const [id,code,type,subtype] of [[fixed,"1500","ASSET","FIXED_ASSET"],[loan,"2500","LIABILITY","LONG_TERM_LIABILITY"]])await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,$3,'Comparatif','Comparison',$4::account_type,$5::account_subtype,now())",[id,W.companyA,code,type,subtype]);
 await createFiscalYear(actor,{containing:"2027-01-01"});await createFiscalYear(actor,{containing:"2028-01-01",now:new Date("2027-06-01T12:00:00Z")});
 await post("2026-12-01",W.bank,W.capital,100000n);await post("2026-12-31",W.bank,W.sales,10000n);
 await post("2027-01-01",W.bank,W.sales,15000n);await post("2027-01-15",fixed,loan,20000n);
 const expense=await post("2026-12-30",W.expenses,W.bank,2000n);await reverseEntry(actor,expense.id,{date:"2027-01-31",memo:"Reverse at cutoff"});
 await post("2027-02-01",W.bank,W.sales,90000n);
});
afterAll(async()=>{await db?.end();});
it("compares cumulative balances at inclusive cutoffs with each fiscal year's earnings split",async()=>{
 const r=await getBalanceComparison(actor,dates);
 expect(r.current).toEqual({asOf:dates.asOf,fiscalYearStart:"2027-01-01"});expect(r.reference.fiscalYearStart).toBe("2026-01-01");
 expect(r.figures.priorEarnings).toMatchObject({currentCents:8000n,referenceCents:0n,differenceCents:8000n});
 expect(r.figures.currentEarnings).toMatchObject({currentCents:17000n,referenceCents:8000n,differenceCents:9000n});
 expect(r.figures.totalAssets).toMatchObject({currentCents:145000n,referenceCents:108000n,differenceCents:37000n});
 expect(r.sections.fixedAssets.lines[0]).toMatchObject({accountId:fixed,currentCents:20000n,referenceCents:0n,percentHundredths:null});
 expect(r.sections.longTermLiabilities.total.currentCents).toBe(20000n);
 expect(r.currentBalanced&&r.referenceBalanced).toBe(true);expect(r.balanceGap.differenceCents).toBe(0n);
 for(const side of ["current","reference"] as const){const standard=await getBalanceSheet(actor,side==="current"?dates.asOf:dates.referenceAsOf);for(const k of BALANCE_COMPARISON_FIGURES)expect(r.figures[k][`${side}Cents`]).toBe(standard.sheet[`${k}Cents`]);}
});
it("reclassifies earnings at a year boundary without changing equity or posting entries",async()=>{
 const r=await getBalanceComparison(actor,{asOf:"2028-01-01",referenceAsOf:"2027-12-31"});
 expect(r.figures.priorEarnings).toMatchObject({currentCents:115000n,referenceCents:8000n});
 expect(r.figures.currentEarnings).toMatchObject({currentCents:0n,referenceCents:107000n});
 expect(r.figures.totalEquity.differenceCents).toBe(0n);
 const before=await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE company_id=$1",[W.companyA]);
 await getBalanceComparison(actor,dates);
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE company_id=$1",[W.companyA])).rows).toEqual(before.rows);
});
it("allows identical and reversed dates and matches the no-fiscal-year fallback",async()=>{
 const same=await getBalanceComparison(actor,{asOf:dates.asOf,referenceAsOf:dates.asOf});for(const k of BALANCE_COMPARISON_FIGURES)expect(same.figures[k].differenceCents).toBe(0n);
 const reverse=await getBalanceComparison(actor,{asOf:dates.referenceAsOf,referenceAsOf:dates.asOf});expect(reverse.figures.totalAssets.differenceCents).toBe(-37000n);
 const r=await getBalanceComparison(actor,{asOf:"2031-01-01",referenceAsOf:"2025-12-31"});expect(r.current.fiscalYearStart).toBeNull();expect(r.figures.priorEarnings.currentCents).toBe(0n);expect(r.figures.currentEarnings.currentCents).toBe(115000n);expect(r.figures.totalAssets.referenceCents).toBe(0n);expect(r.referenceBalanced).toBe(true);
});
it("requires accounting access, isolates tenants and rejects invalid dates",async()=>{
 const reader={...actor,userId:W.userReader};await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",sales:"none",taxes:"none",contacts:"none"})]);expect((await getBalanceComparison(reader,dates)).figures.totalAssets.currentCents).toBe(145000n);
 expect((await getBalanceComparison({userId:W.userOwnerB,companyId:W.companyB},dates)).figures.totalAssets.currentCents).toBe(0n);
 await expect(getBalanceComparison({userId:W.userOwnerB,companyId:W.companyA},dates)).rejects.toThrow();
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"none"})]);await expect(getBalanceComparison(reader,dates)).rejects.toThrow();
 for(const bad of ["2026-02-30","","1899-12-31"]){await expect(getBalanceComparison(actor,{...dates,asOf:bad})).rejects.toMatchObject({key:"reports.period"});await expect(getBalanceComparison(actor,{...dates,referenceAsOf:bad})).rejects.toMatchObject({key:"reports.period"});}
});
it("keeps inactive accounts and closed fiscal years readable without altering their balances",async()=>{
 await db.query("UPDATE account SET is_active=false WHERE id=$1",[fixed]);const before=await getBalanceComparison(actor,dates);expect(before.sections.fixedAssets.lines[0]!.accountId).toBe(fixed);
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);await db.query("UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);expect(await getBalanceComparison(actor,dates)).toEqual(before);
});
