import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { createBudget,listBudgets,getBudgetComparison,saveBudgetTarget,removeBudgetTarget } from "@/modules/budgets";
import { postManualEntry,reverseEntry } from "@/modules/ledger";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld,W,appClient,inContext,asOwnerA,asReader,asOwnerB,sqlstate } from "./world";
let db:pg.Client,app:pg.Client,id:string,inactive:string;
const actor={userId:W.userOwnerA,companyId:W.companyA};
const reader={...actor,userId:W.userReader};
const rev=async()=>(await getBudgetComparison(actor,id)).revision;
const save=async(accountId:string,amountCents:bigint)=>saveBudgetTarget(actor,id,{accountId,amountCents,revision:await rev()});
const post=(date:string,debit:string,credit:string,amount:bigint)=>postManualEntry(actor,{date,kind:"MANUAL",memo:"Budget fixture",lines:[{accountId:debit,debitCents:amount,creditCents:0n},{accountId:credit,debitCents:0n,creditCents:amount}]});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);app=await appClient();
 await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 inactive=randomUUID();await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,'7000','Autres','Other','EXPENSE','OTHER_EXPENSE',now())",[inactive,W.companyA]);
 id=await createBudget(actor,{name:"Scenario 2026",fiscalYearId:W.fiscalYearA});
 await post("2026-01-01",W.bank,W.sales,10000n);await post("2026-12-31",W.bank,W.sales,25000n);
 const expense=await post("2026-06-15",W.expenses,W.bank,3000n);await reverseEntry(actor,expense.id,{date:"2026-06-16",memo:"Correction"});
 await post("2026-10-15",inactive,W.bank,500n);
});
afterAll(async()=>{await app?.end();await db?.end();});
it("distinguishes missing and zero targets, includes full-year boundaries, reversals and unbudgeted activity",async()=>{
 await save(W.sales,40000n);await save(W.expenses,0n);
 const r=await getBudgetComparison(actor,id);
 expect(r.from).toBe('2026-01-01');expect(r.to).toBe('2026-12-31');
 expect(r.rows.find(r=>r.accountId===W.sales)).toMatchObject({targetCents:40000n,actualCents:35000n,differenceCents:-5000n});
 expect(r.rows.find(r=>r.accountId===W.expenses)).toMatchObject({targetCents:0n,actualCents:0n,hasActivity:true,differenceCents:0n});
 expect(r.rows.find(r=>r.accountId===inactive)).toMatchObject({targetCents:null,actualCents:500n,differenceCents:null});
 expect(r.expenses).toEqual({targetCents:0n,actualCents:500n,unbudgeted:1});
});
it("serializes concurrent edits and invalidates old revisions on replacement and removal",async()=>{
 const revision=await rev();const results=await Promise.allSettled([saveBudgetTarget(actor,id,{accountId:W.sales,amountCents:41000n,revision}),saveBudgetTarget(actor,id,{accountId:W.sales,amountCents:42000n,revision})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'budgets.stale'}});
 expect(await rev()).toBe(revision+1);
 await removeBudgetTarget(actor,id,W.expenses,await rev());
 await expect(removeBudgetTarget(actor,id,W.sales,revision)).rejects.toMatchObject({key:'budgets.stale'});
 expect((await getBudgetComparison(actor,id)).rows.find(r=>r.accountId===W.expenses)).toMatchObject({targetCents:null,actualCents:0n,hasActivity:true});
});
it("validates names, amounts, account classes and cross-company scope before mutation",async()=>{
 for(const name of ['', 'X'.repeat(121), 'bad\nname'])await expect(createBudget(actor,{name,fiscalYearId:W.fiscalYearA})).rejects.toMatchObject({key:'budgets.invalid'});
 await expect(createBudget(actor,{name:'Scenario 2026',fiscalYearId:W.fiscalYearA})).rejects.toMatchObject({key:'budgets.duplicate'});
 await expect(createBudget(actor,{name:'Foreign',fiscalYearId:W.fiscalYearB})).rejects.toMatchObject({key:'budgets.year'});
 for(const amountCents of [-1n,100000000000001n])await expect(save(W.sales,amountCents)).rejects.toMatchObject({key:'budgets.invalid'});
 for(const accountId of [W.bank,W.bankB,randomUUID()])await expect(save(accountId,100n)).rejects.toMatchObject({key:'budgets.account'});
 const foreign={userId:W.userOwnerB,companyId:W.companyB};expect(await listBudgets(foreign)).toEqual([]);
 await expect(getBudgetComparison(foreign,id)).rejects.toMatchObject({key:'budgets.notFound'});
 await expect(saveBudgetTarget(foreign,id,{accountId:W.bankB,amountCents:1n,revision:1})).rejects.toMatchObject({key:'budgets.notFound'});
});
it("enforces Accounting module overrides, read-only clamping and immediate revocation",async()=>{
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:'write',sales:'none',contacts:'none',taxes:'none'})]);
 expect((await getBudgetComparison(reader,id)).rows.length).toBeGreaterThan(0);
 await expect(createBudget(reader,{name:'Denied',fiscalYearId:W.fiscalYearA})).rejects.toMatchObject({key:'forbidden'});
 await expect(saveBudgetTarget(reader,id,{accountId:W.sales,amountCents:1n,revision:await rev()})).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 await saveBudgetTarget(reader,id,{accountId:W.sales,amountCents:45000n,revision:await rev()});
 await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 await expect(getBudgetComparison(reader,id)).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET role='READ_ONLY',module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
});
it("guards direct SQL amount/type/scope writes, revision and tenant reads with audit",async()=>{
 const insert=(account:string,amount:string)=>app.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,now())",[W.companyA,id,account,amount]);
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(W.bank,'100')))).toBe('AL004');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(W.expenses,'-1')))).toBe('23514');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(W.expenses,'100000000000001')))).toBe('23514');
 expect(await sqlstate(()=>inContext(app,asReader,()=>insert(W.expenses,'1')))).toBe('42501');
 expect((await inContext(app,asOwnerB,()=>app.query("SELECT id FROM budget WHERE id=$1",[id]))).rowCount).toBe(0);
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query("UPDATE budget SET revision=revision WHERE id=$1",[id])))).toBe('AL004');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query("UPDATE budget SET fiscal_year_id=$2,revision=revision+1 WHERE id=$1",[id,W.fiscalYearB])))).toBe('AL004');
 const old=await rev();await inContext(app,asOwnerA,()=>insert(W.expenses,'123'),{commit:true});expect(await rev()).toBe(old+1);
 expect(Number((await db.query("SELECT count(*) FROM audit_log WHERE entity_type IN ('budget','budget_line') AND company_id=$1",[W.companyA])).rows[0].count)).toBeGreaterThan(5);
});
it("retains inactive targets, refuses new inactive targets and keeps closed-year actuals intact",async()=>{
 await save(inactive,1000n);await db.query('UPDATE account SET is_active=false WHERE id=$1',[inactive]);await save(inactive,1200n);
 expect((await getBudgetComparison(actor,id)).rows.find(r=>r.accountId===inactive)).toMatchObject({isActive:false,targetCents:1200n,actualCents:500n});
 await removeBudgetTarget(actor,id,inactive,await rev());await expect(save(inactive,1000n)).rejects.toMatchObject({key:'budgets.account'});
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);
 await db.query("UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);
 const count=Number((await db.query('SELECT count(*) FROM journal_entry')).rows[0].count);await save(W.sales,50000n);
 expect((await getBudgetComparison(actor,id)).revenue.actualCents).toBe(35000n);
 expect(Number((await db.query('SELECT count(*) FROM journal_entry')).rows[0].count)).toBe(count);
 await withCompany(actor,async tx=>expect(await tx.budget.count()).toBe(1));
});
it("returns exactly 1,000 accounts and refuses oversized reports instead of truncating",async()=>{
 const other={userId:W.userOwnerB,companyId:W.companyB};const budget=await createBudget(other,{name:'Capacity',fiscalYearId:W.fiscalYearB});
 await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) SELECT gen_random_uuid(),$1,'CAP-'||lpad(n::text,4,'0'),'Capacité','Capacity','EXPENSE','OTHER_EXPENSE',now() FROM generate_series(1,1001) n",[W.companyB]);
 await inContext(db,asOwnerB,()=>db.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,$2,id,1,now() FROM account WHERE company_id=$1 AND code LIKE 'CAP-%' ORDER BY code LIMIT 1000",[W.companyB,budget]),{commit:true});
 const r=await getBudgetComparison(other,budget);expect(r.rows).toHaveLength(1000);expect(r.expenses.targetCents).toBe(1000n);
 await expect(db.query("UPDATE account SET type='REVENUE',subtype='OTHER_REVENUE' WHERE company_id=$1 AND code='CAP-0001'",[W.companyB])).rejects.toMatchObject({code:'AL005'});
 const last=(await db.query("SELECT id FROM account WHERE company_id=$1 AND code='CAP-1001'",[W.companyB])).rows[0].id;
 await expect(saveBudgetTarget(other,budget,{accountId:last,amountCents:1n,revision:r.revision})).rejects.toMatchObject({key:'budgets.tooMany'});
 // A privileged import can exceed the service limit. Readers must get an explicit refusal, never a partial report.
 await inContext(db,asOwnerB,()=>db.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,1,now())",[W.companyB,budget,last]),{commit:true});
 await expect(getBudgetComparison(other,budget)).rejects.toMatchObject({key:'budgets.tooMany'});
});
