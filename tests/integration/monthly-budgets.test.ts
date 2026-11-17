import { randomUUID } from 'node:crypto';
import { beforeAll,afterAll,it,expect } from 'vitest';
import type pg from 'pg';
import { createBudget,getBudgetComparison,getMonthlyAllocation,getMonthlyBudget,saveMonthlyAllocation,saveBudgetTarget,removeBudgetTarget,getBudgetCopyPreview,duplicateBudget } from '@/modules/budgets';
import { postManualEntry,reverseEntry,createFiscalYear } from '@/modules/ledger';
import { owner } from './helpers';
import { W,seedWorld,appClient,setContext,inContext,asOwnerA,asOwnerB,asReader,sqlstate } from './world';
let db:pg.Client,app:pg.Client,budget:string,otherExpense:string,otherPeriod:string;
const actor={userId:W.userOwnerA,companyId:W.companyA};
const rev=async()=>(await getBudgetComparison(actor,budget)).revision;
const data=async(accountId:string=W.sales)=>getMonthlyAllocation(actor,budget,accountId);
async function targets(accountId:string,amounts:(bigint|null)[]){const a=await data(accountId);return {revision:a.budget.revision,targets:a.periods.map((p,i)=>({periodId:p.id,amountCents:amounts[i]??null}))};}
const post=(date:string,debit:string,credit:string,amount:bigint)=>postManualEntry(actor,{date,kind:'MANUAL',memo:'Monthly fixture',lines:[{accountId:debit,debitCents:amount,creditCents:0n},{accountId:credit,debitCents:0n,creditCents:amount}]});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);app=await appClient();await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 otherPeriod=(await createFiscalYear(actor,{containing:'2027-01-01'})).periods[0]!.id;
 budget=await createBudget(actor,{name:'Monthly scenario',fiscalYearId:W.fiscalYearA});
 await saveBudgetTarget(actor,budget,{accountId:W.sales,amountCents:30000n,revision:await rev()});await saveBudgetTarget(actor,budget,{accountId:W.expenses,amountCents:10000n,revision:await rev()});
 await post('2026-01-01',W.bank,W.sales,10000n);await post('2026-01-31',W.bank,W.sales,5000n);const expense=await post('2026-01-25',W.expenses,W.bank,2000n);await post('2026-02-01',W.expenses,W.bank,3000n);await reverseEntry(actor,expense.id,{date:'2026-02-02',memo:'Monthly correction'});
 otherExpense=randomUUID();await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,'7990','Historique','Historical','EXPENSE','OTHER_EXPENSE',now())",[otherExpense,W.companyA]);await post('2026-01-10',otherExpense,W.bank,500n);await db.query('UPDATE account SET is_active=false WHERE id=$1',[otherExpense]);
});
afterAll(async()=>{await app?.end();await db?.end();});
it('reads exact fiscal boundaries, signed actuals, reversals and inactive unbudgeted activity',async()=>{
 const a=await data();await saveMonthlyAllocation(actor,budget,W.sales,await targets(W.sales,[12000n,9000n]));await saveMonthlyAllocation(actor,budget,W.expenses,await targets(W.expenses,[0n,5000n]));
 const jan=await getMonthlyBudget(actor,budget,a.periods[0]!.id),feb=await getMonthlyBudget(actor,budget,a.periods[1]!.id);
 expect(jan.selected).toMatchObject({from:'2026-01-01',to:'2026-01-31'});expect(jan.revenue).toEqual({targetCents:12000n,actualCents:15000n,unbudgeted:0});
 expect(jan.rows.find(r=>r.accountId===W.sales)).toMatchObject({differenceCents:3000n,allocation:{allocatedCents:21000n,remainingCents:9000n,definedCount:2,complete:false}});
 expect(jan.rows.find(r=>r.accountId===W.expenses)).toMatchObject({targetCents:0n,actualCents:2000n,differenceCents:2000n});expect(jan.rows.find(r=>r.accountId===otherExpense)).toMatchObject({annualCents:null,targetCents:null,actualCents:500n,isActive:false,differenceCents:null});
 expect(feb.expenses.actualCents).toBe(1000n);expect(feb.rows.find(r=>r.accountId===W.sales)).toMatchObject({targetCents:9000n,actualCents:0n,differenceCents:-9000n});expect(jan.expenses.unbudgeted).toBe(1);
});
it('replaces allocations atomically, permits redistribution and clears months without removing annual goals',async()=>{
 const before=await data();await saveMonthlyAllocation(actor,budget,W.sales,await targets(W.sales,[0n,30000n]));const after=await data();expect(after.budget.revision).toBeGreaterThan(before.budget.revision);expect(after.account.months[0]?.targetCents).toBe(0n);
 await saveMonthlyAllocation(actor,budget,W.sales,await targets(W.sales,Array(12).fill(null)));expect((await data()).account.months.every(m=>m.targetCents===null)).toBe(true);expect((await data()).account.annualCents).toBe(30000n);
 await saveMonthlyAllocation(actor,budget,W.sales,await targets(W.sales,Array(12).fill(2500n)));expect((await getMonthlyBudget(actor,budget,(await data()).periods[0]!.id)).rows.find(r=>r.accountId===W.sales)?.allocation?.complete).toBe(true);
});
it('refuses excess sums, duplicate/foreign periods and stale revisions without partial writes',async()=>{
 const before=await data(),valid=await targets(W.sales,Array(12).fill(2500n));
 await expect(saveMonthlyAllocation(actor,budget,W.sales,{...valid,targets:valid.targets.map((t,i)=>i?t:{...t,amountCents:2501n})})).rejects.toMatchObject({key:'budgets.monthlyExcess'});
 await expect(saveMonthlyAllocation(actor,budget,W.sales,{...valid,targets:valid.targets.map(()=>valid.targets[0]!)})).rejects.toMatchObject({key:'budgets.monthlyInvalid'});
 const foreign=(await db.query('SELECT id FROM fiscal_period WHERE company_id=$1 LIMIT 1',[W.companyB])).rows[0].id;await expect(saveMonthlyAllocation(actor,budget,W.sales,{...valid,targets:valid.targets.map((t,i)=>i?t:{...t,periodId:foreign})})).rejects.toMatchObject({key:'budgets.monthlyInvalid'});expect(await data()).toEqual(before);
 const results=await Promise.allSettled([saveMonthlyAllocation(actor,budget,W.sales,valid),saveMonthlyAllocation(actor,budget,W.sales,valid)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'budgets.stale'}});
});
it('protects annual reductions/removal and keeps duplication explicitly annual',async()=>{
 await expect(saveBudgetTarget(actor,budget,{accountId:W.sales,amountCents:29999n,revision:await rev()})).rejects.toMatchObject({key:'budgets.monthlyAnnualFloor'});await expect(removeBudgetTarget(actor,budget,W.sales,await rev())).rejects.toMatchObject({key:'budgets.monthlyInUse'});
 const p=await getBudgetCopyPreview(actor,budget),id=await duplicateBudget(actor,budget,{name:'Annual-only copy',fiscalYearId:W.fiscalYearA,sourceRevision:p.source.revision,stateToken:p.stateToken,skipInactive:false});expect((await getMonthlyAllocation(actor,id,W.sales)).account.months.every(m=>m.targetCents===null)).toBe(true);
});
it('enforces modular permissions, read-only clamping and tenant isolation',async()=>{
 const reader={...actor,userId:W.userReader},p=(await data()).periods[0]!.id;await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 expect((await getMonthlyBudget(reader,budget,p)).revenue.actualCents).toBe(15000n);await expect(saveMonthlyAllocation(reader,budget,W.sales,await targets(W.sales,Array(12).fill(2500n)))).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET role='USER' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await saveMonthlyAllocation(reader,budget,W.sales,await targets(W.sales,Array(12).fill(2500n)));
 await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(getMonthlyBudget(reader,budget,p)).rejects.toMatchObject({key:'forbidden'});await db.query("UPDATE membership SET role='READ_ONLY',module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 await expect(getMonthlyBudget({userId:W.userOwnerB,companyId:W.companyB},budget,p)).rejects.toMatchObject({key:'budgets.notFound'});await expect(getMonthlyBudget(actor,budget,randomUUID())).rejects.toMatchObject({key:'budgets.monthlyPeriod'});
});
it('rejects direct SQL over-allocation, mismatched fiscal years, identity moves and repeatable-read writes',async()=>{
 const a=await data(),line=a.account.lineId,p=a.periods[0]!.id;
 const insert=(period:string,amount:number)=>app.query('INSERT INTO budget_monthly_target(id,company_id,budget_line_id,fiscal_period_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,now())',[W.companyA,line,period,amount]);
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('UPDATE budget_monthly_target SET amount_cents=amount_cents+1 WHERE budget_line_id=$1 AND fiscal_period_id=$2',[line,p])))).toBe('AL004');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('UPDATE budget_line SET amount_cents=1 WHERE id=$1',[line])))).toBe('AL004');
 const foreign=(await db.query('SELECT id FROM fiscal_period WHERE company_id=$1 LIMIT 1',[W.companyB])).rows[0].id;expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(foreign,1)))).toBe('AL004');expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(otherPeriod,1)))).toBe('AL004');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('UPDATE budget_monthly_target SET amount_cents=-1 WHERE budget_line_id=$1 AND fiscal_period_id=$2',[line,p])))).toBe('23514');
 expect(await sqlstate(()=>inContext(app,asReader,()=>insert(p,1)))).toBe('42501');expect((await inContext(app,asOwnerB,()=>app.query('SELECT id FROM budget_monthly_target WHERE company_id=$1',[W.companyA]))).rowCount).toBe(0);
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('UPDATE budget_monthly_target SET fiscal_period_id=$2 WHERE budget_line_id=$1 AND fiscal_period_id=$3',[line,a.periods[1]!.id,p])))).toBe('AL004');
 await app.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await setContext(app,asOwnerA);expect(await sqlstate(()=>insert(p,1))).toBe('AL004');}finally{await app.query('ROLLBACK');}
});
it('serializes direct SQL writers on the parent and sees committed sibling sums after waiting',async()=>{
 const fresh=await createBudget(actor,{name:'Race',fiscalYearId:W.fiscalYearA});await saveBudgetTarget(actor,fresh,{accountId:W.sales,amountCents:10000n,revision:1});const a=await getMonthlyAllocation(actor,fresh,W.sales),first=await appClient(),second=await appClient();
 try{
  await first.query('BEGIN');await setContext(first,asOwnerA);await second.query('BEGIN');await setContext(second,asOwnerA);const pid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const sql='INSERT INTO budget_monthly_target(id,company_id,budget_line_id,fiscal_period_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,now())';
  await first.query(sql,[W.companyA,a.account.lineId,a.periods[0]!.id,7000]);const waiting=second.query(sql,[W.companyA,a.account.lineId,a.periods[1]!.id,6000]).then(()=>null,e=>(e as {code:string}).code);
  await expect.poll(async()=>Boolean((await db.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked)).toBe(true);
  await first.query('COMMIT');expect(await waiting).toBe('AL004');await second.query('ROLLBACK');expect((await getMonthlyAllocation(actor,fresh,W.sales)).account.months.filter(m=>m.targetCents!==null)).toHaveLength(1);
 }finally{await first.query('ROLLBACK');await second.query('ROLLBACK');await first.end();await second.end();}
});
it('rolls back replacement, revisions and audit if a later monthly insert fails',async()=>{
 const before=await data(),audit=(await db.query('SELECT count(*) FROM audit_log')).rows[0].count;
 await db.query("CREATE FUNCTION fixture_month_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT period_number FROM fiscal_period WHERE id=NEW.fiscal_period_id)=2 THEN RAISE EXCEPTION 'fixture failure' USING ERRCODE='AL004'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_month_failure BEFORE INSERT ON budget_monthly_target FOR EACH ROW EXECUTE FUNCTION fixture_month_failure()");
 try{await expect(saveMonthlyAllocation(actor,budget,W.sales,await targets(W.sales,Array(12).fill(1000n)))).rejects.toThrow();expect(await data()).toEqual(before);expect((await db.query('SELECT count(*) FROM audit_log')).rows[0].count).toBe(audit);}finally{await db.query('DROP TRIGGER fixture_month_failure ON budget_monthly_target; DROP FUNCTION fixture_month_failure()');}
});
it('rejects an annual reduction that waited for a committed monthly allocation',async()=>{
 const fresh=await createBudget(actor,{name:'Annual race',fiscalYearId:W.fiscalYearA});await saveBudgetTarget(actor,fresh,{accountId:W.sales,amountCents:10000n,revision:1});const a=await getMonthlyAllocation(actor,fresh,W.sales),first=await appClient(),second=await appClient();
 try{
  await first.query('BEGIN');await setContext(first,asOwnerA);await second.query('BEGIN');await setContext(second,asOwnerA);const pid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await first.query('INSERT INTO budget_monthly_target(id,company_id,budget_line_id,fiscal_period_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,7000,now())',[W.companyA,a.account.lineId,a.periods[0]!.id]);
  const waiting=second.query('UPDATE budget_line SET amount_cents=6000 WHERE id=$1',[a.account.lineId]).then(()=>null,e=>(e as {code:string}).code);
  await expect.poll(async()=>Boolean((await db.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked)).toBe(true);
  await first.query('COMMIT');expect(await waiting).toBe('AL004');await second.query('ROLLBACK');expect((await getMonthlyAllocation(actor,fresh,W.sales)).account.annualCents).toBe(10000n);
 }finally{await first.query('ROLLBACK');await second.query('ROLLBACK');await first.end();await second.end();}
});
it('permits planning in closed fiscal years without reopening periods or changing the journal',async()=>{
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);await db.query("UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE company_id=$1",[W.companyA,W.userOwnerA]);const n=(await db.query('SELECT count(*) FROM journal_entry')).rows[0].count;
 await saveMonthlyAllocation(actor,budget,W.sales,await targets(W.sales,[10000n,10000n,10000n]));expect((await db.query('SELECT count(*) FROM journal_entry')).rows[0].count).toBe(n);expect((await db.query('SELECT status FROM fiscal_year WHERE id=$1',[W.fiscalYearA])).rows[0].status).toBe('CLOSED');
});
