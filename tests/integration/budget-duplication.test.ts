import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { createBudget,getBudgetComparison,saveBudgetTarget,getBudgetCopyPreview,duplicateBudget } from "@/modules/budgets";
import { createFiscalYear,postManualEntry } from "@/modules/ledger";
import { owner } from "./helpers";
import { seedWorld,W,inContext,asOwnerA } from "./world";
let db:pg.Client,sourceId:string,expenseId:string;
const actor={userId:W.userOwnerA,companyId:W.companyA};
const reader={...actor,userId:W.userReader};
const preview=()=>getBudgetCopyPreview(actor,sourceId);
const input=async(name:string)=>{const p=await preview();return {name,fiscalYearId:W.fiscalYearA,sourceRevision:p.source.revision,stateToken:p.stateToken,skipInactive:false};};
const count=async(table:string)=>Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
beforeAll(async()=>{
 db=await owner();await seedWorld(db);
 await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 await postManualEntry(actor,{date:'2026-06-01',kind:'MANUAL',memo:'Existing actuals are not copied',lines:[{accountId:W.bank,debitCents:10001n,creditCents:0n},{accountId:W.sales,debitCents:0n,creditCents:10001n}]});
 expenseId=randomUUID();await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,'7990','À dupliquer','For duplication','EXPENSE','OTHER_EXPENSE',now())",[expenseId,W.companyA]);
 sourceId=await createBudget(actor,{name:'Source',fiscalYearId:W.fiscalYearA});
 for(const [accountId,amountCents] of [[W.sales,100000000000000n],[W.expenses,0n],[expenseId,12345n]] as const){const revision=(await getBudgetComparison(actor,sourceId)).revision;await saveBudgetTarget(actor,sourceId,{accountId,amountCents,revision});}
});
afterAll(async()=>{await db?.end();});
it('copies exact targets including zero atomically, leaves source unchanged, and creates independent targets',async()=>{
 const before=await preview(),journals=await count('journal_entry'),audit=await count('audit_log');
 const id=await duplicateBudget(actor,sourceId,await input('Independent copy'));
 const after=await preview(),copy=await getBudgetCopyPreview(actor,id);
 expect(after).toEqual(before);expect(copy.source.revision).toBe(4);expect(copy.targets).toEqual(before.targets);expect(copy.source.id).not.toBe(sourceId);
 const event=(await db.query("SELECT actor_user_id,company_id,after FROM audit_log WHERE entity_id=$1 AND action='budget.duplicate'",[id])).rows[0];expect(event).toEqual({actor_user_id:actor.userId,company_id:actor.companyId,after:{sourceBudgetId:sourceId,sourceRevision:before.source.revision,copiedTargetCount:3,excludedAccountIds:[]}});
 expect(await count('journal_entry')).toBe(journals);expect(await count('audit_log')).toBeGreaterThan(audit);
 await saveBudgetTarget(actor,id,{accountId:W.sales,amountCents:1n,revision:copy.source.revision});
 expect((await preview()).activeRevenueCents).toBe(100000000000000n);
 expect((await getBudgetCopyPreview(actor,id)).activeRevenueCents).toBe(1n);
});
it('requires an explicit exclusion choice for inactive targets and rejects changed account eligibility or labels',async()=>{
 const before=await input('Inactive test');await db.query('UPDATE account SET is_active=false WHERE id=$1',[expenseId]);
 await expect(duplicateBudget(actor,sourceId,before)).rejects.toMatchObject({key:'budgets.copyStale'});
 const fresh=await input('Inactive test');const p=await preview();expect(p.inactiveCount).toBe(1);expect(p.inactiveExpenseCents).toBe(12345n);
 const budgets=await count('budget');await expect(duplicateBudget(actor,sourceId,fresh)).rejects.toMatchObject({key:'budgets.copyInactive'});expect(await count('budget')).toBe(budgets);
 const id=await duplicateBudget(actor,sourceId,{...fresh,skipInactive:true});const copy=await getBudgetCopyPreview(actor,id);expect(copy.targets).toHaveLength(2);expect(copy.targets.find(r=>r.accountId===W.expenses)?.amountCents).toBe(0n);expect(copy.inactiveCount).toBe(0);expect((await db.query("SELECT after FROM audit_log WHERE entity_id=$1 AND action='budget.duplicate'",[id])).rows[0].after.excludedAccountIds).toEqual([expenseId]);
 await db.query("UPDATE account SET name_en='Renamed after review' WHERE id=$1",[expenseId]);await expect(duplicateBudget(actor,sourceId,{...fresh,name:'Renamed',skipInactive:true})).rejects.toMatchObject({key:'budgets.copyStale'});
 await db.query('UPDATE account SET is_active=true WHERE id=$1',[expenseId]);
});
it('rejects changed source revisions, invalid previews and foreign fiscal years without creating a destination',async()=>{
 const stale=await input('Stale');await saveBudgetTarget(actor,sourceId,{accountId:W.sales,amountCents:99999n,revision:stale.sourceRevision});
 const n=await count('budget');await expect(duplicateBudget(actor,sourceId,stale)).rejects.toMatchObject({key:'budgets.copyStale'});
 const fresh=await input('Foreign year');await expect(duplicateBudget(actor,sourceId,{...fresh,fiscalYearId:W.fiscalYearB})).rejects.toMatchObject({key:'budgets.year'});
 await expect(duplicateBudget(actor,sourceId,{...fresh,stateToken:'0'.repeat(64)})).rejects.toMatchObject({key:'budgets.copyStale'});
 await expect(duplicateBudget(actor,sourceId,{...fresh,stateToken:'invalid'})).rejects.toMatchObject({key:'budgets.invalid'});
 expect(await count('budget')).toBe(n);
});
it('honors Accounting write overrides, clamps read-only users and isolates companies',async()=>{
 const fresh=await input('Permission test');await expect(getBudgetCopyPreview(reader,sourceId)).rejects.toMatchObject({key:'forbidden'});
 await expect(duplicateBudget(reader,sourceId,fresh)).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 expect((await getBudgetCopyPreview(reader,sourceId)).targets).toHaveLength(3);await duplicateBudget(reader,sourceId,fresh);
 await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(getBudgetCopyPreview(reader,sourceId)).rejects.toMatchObject({key:'forbidden'});
 const other={userId:W.userOwnerB,companyId:W.companyB};await expect(getBudgetCopyPreview(other,sourceId)).rejects.toMatchObject({key:'budgets.notFound'});await expect(duplicateBudget(other,sourceId,{...fresh,fiscalYearId:W.fiscalYearB})).rejects.toMatchObject({key:'budgets.notFound'});
 await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(duplicateBudget(reader,sourceId,fresh)).rejects.toMatchObject({key:'forbidden'});
});
it('serializes concurrent duplicate names and rolls back a failed line insert including its audit records',async()=>{
 const fresh=await input('Concurrent name');const before=await count('budget');const result=await Promise.allSettled([duplicateBudget(actor,sourceId,fresh),duplicateBudget(actor,sourceId,fresh)]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(result.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'budgets.duplicate'}});expect(await count('budget')).toBe(before+1);
 const n=await count('budget'),lines=await count('budget_line'),audit=await count('audit_log');
 await db.query("CREATE FUNCTION fixture_copy_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='00000000-0000-7000-8000-00000000a500'::uuid THEN RAISE EXCEPTION 'fixture failure' USING ERRCODE='AL004'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_copy_failure BEFORE INSERT ON budget_line FOR EACH ROW EXECUTE FUNCTION fixture_copy_failure()");
 try {await expect(duplicateBudget(actor,sourceId,await input('Must roll back'))).rejects.toThrow();expect(await count('budget')).toBe(n);expect(await count('budget_line')).toBe(lines);expect(await count('audit_log')).toBe(audit);}
 finally {await db.query('DROP TRIGGER fixture_copy_failure ON budget_line; DROP FUNCTION fixture_copy_failure()');}
});
it('copies into another existing fiscal year and leaves a closed source year untouched',async()=>{
 const year=await createFiscalYear(actor,{containing:'2027-01-01'});
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE fiscal_year_id=$1",[W.fiscalYearA,W.userOwnerA]);
 await db.query("UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE id=$1",[W.fiscalYearA,W.userOwnerA]);
 const before=await preview(),id=await duplicateBudget(actor,sourceId,{...await input('Next fiscal year'),fiscalYearId:year.id});
 const copied=await getBudgetCopyPreview(actor,id);expect(copied.source.from).toBe('2027-01-01');expect(copied.source.to).toBe('2027-12-31');expect(copied.targets).toEqual(before.targets);expect(await preview()).toEqual(before);expect((await getBudgetComparison(actor,id)).revenue.actualCents).toBe(0n);expect((await getBudgetComparison(actor,sourceId)).revenue.actualCents).toBe(10001n);
 expect((await db.query('SELECT status FROM fiscal_year WHERE id=$1',[W.fiscalYearA])).rows[0].status).toBe('CLOSED');
});
it('supports an empty scenario and refuses oversized source previews and copies instead of truncating',async()=>{
 const empty=await createBudget(actor,{name:'Empty source',fiscalYearId:W.fiscalYearA});const p=await getBudgetCopyPreview(actor,empty);expect(p.activeCount).toBe(0);const copied=await duplicateBudget(actor,empty,{name:'Empty copy',fiscalYearId:W.fiscalYearA,sourceRevision:p.source.revision,stateToken:p.stateToken,skipInactive:false});expect((await getBudgetCopyPreview(actor,copied)).targets).toEqual([]);
 const large=await createBudget(actor,{name:'Capacity source',fiscalYearId:W.fiscalYearA});
 await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) SELECT gen_random_uuid(),$1,'DUP-'||lpad(n::text,4,'0'),'Capacité','Capacity','EXPENSE','OTHER_EXPENSE',now() FROM generate_series(1,1001) n",[W.companyA]);
 await inContext(db,asOwnerA,()=>db.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,$2,id,1,now() FROM account WHERE company_id=$1 AND code LIKE 'DUP-%' ORDER BY code LIMIT 1000",[W.companyA,large]),{commit:true});
 const capacity=await getBudgetCopyPreview(actor,large);expect(capacity.targets).toHaveLength(1000);
 const copiedLarge=await duplicateBudget(actor,large,{name:'Capacity copy',fiscalYearId:W.fiscalYearA,sourceRevision:capacity.source.revision,stateToken:capacity.stateToken,skipInactive:false});expect((await getBudgetCopyPreview(actor,copiedLarge)).targets).toHaveLength(1000);
 await inContext(db,asOwnerA,()=>db.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,$2,id,1,now() FROM account WHERE company_id=$1 AND code='DUP-1001'",[W.companyA,large]),{commit:true});
 await expect(getBudgetCopyPreview(actor,large)).rejects.toMatchObject({key:'budgets.tooMany'});
 const revision=Number((await db.query('SELECT revision FROM budget WHERE id=$1',[large])).rows[0].revision);
 await expect(duplicateBudget(actor,large,{name:'Oversized',fiscalYearId:W.fiscalYearA,sourceRevision:revision,stateToken:capacity.stateToken,skipInactive:false})).rejects.toMatchObject({key:'budgets.tooMany'});
});
