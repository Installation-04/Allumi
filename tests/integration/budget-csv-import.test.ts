import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { getBudgetImportAccounts,importBudgetCsv,previewBudgetCsv,budgetImportReview,getBudgetComparison,listBudgets } from "@/modules/budgets";
import { createFiscalYear,postManualEntry } from "@/modules/ledger";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
let db:pg.Client;
const actor={userId:W.userOwnerA,companyId:W.companyA};
const csv='account_code,annual_target\n4000,1000000000000.00\n5000,0.00';
const count=async(table:string)=>Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
async function input(name:string,text=csv){const accounts=await getBudgetImportAccounts(actor);return {name,fiscalYearId:W.fiscalYearA,format:'en' as const,text,review:budgetImportReview(previewBudgetCsv(text,'en',accounts))};}
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
 await postManualEntry(actor,{date:'2026-06-01',kind:'MANUAL',memo:'Existing actuals',lines:[{accountId:W.bank,debitCents:25001n,creditCents:0n},{accountId:W.sales,debitCents:0n,creditCents:25001n}]});
});
afterAll(async()=>{await db?.end();});
it('creates exact annual targets including zero, preserves journals and audits content identity without storing the CSV',async()=>{
 const n=await count('journal_entry'),data=await input('CSV import'),id=await importBudgetCsv(actor,data),r=await getBudgetComparison(actor,id);
 expect(r.rows.find(r=>r.accountId===W.sales)).toMatchObject({targetCents:100000000000000n,actualCents:25001n});expect(r.rows.find(r=>r.accountId===W.expenses)?.targetCents).toBe(0n);expect(r.revision).toBe(3);expect(await count('journal_entry')).toBe(n);
 const event=(await db.query("SELECT company_id,actor_user_id,after FROM audit_log WHERE entity_id=$1 AND action='budget.import_csv'",[id])).rows[0];expect(event.company_id).toBe(actor.companyId);expect(event.actor_user_id).toBe(actor.userId);expect(event.after).toMatchObject({format:'en',targetCount:2});expect(event.after.contentSha256).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(event.after)).not.toContain('annual_target');
});
it('rejects altered preview amounts, injected foreign IDs, invalid files and foreign years before creating a budget',async()=>{
 const data=await input('Changed'),n=await count('budget');
 await expect(importBudgetCsv(actor,{...data,text:csv.replace('5000,0.00','5000,1.00')})).rejects.toMatchObject({key:'budgets.importChanged'});
 await expect(importBudgetCsv(actor,{...data,review:data.review.map((r,i)=>i?{...r,accountId:W.bankB}:r)})).rejects.toMatchObject({key:'budgets.importStale'});
 await expect(importBudgetCsv(actor,{...data,text:'account_code,annual_target\n4000,-1'})).rejects.toMatchObject({key:'budgets.importInvalid'});
 await expect(importBudgetCsv(actor,{...data,fiscalYearId:W.fiscalYearB})).rejects.toMatchObject({key:'budgets.year'});expect(await count('budget')).toBe(n);
});
it('refuses inactive, renamed or wrong-type accounts and reloads a valid review after changes',async()=>{
 const data=await input('Stale');await db.query('UPDATE account SET is_active=false WHERE id=$1',[W.expenses]);
 await expect(importBudgetCsv(actor,data)).rejects.toMatchObject({key:'budgets.importStale'});await db.query('UPDATE account SET is_active=true WHERE id=$1',[W.expenses]);
 await db.query("UPDATE account SET name_en='New name' WHERE id=$1",[W.sales]);await expect(importBudgetCsv(actor,data)).rejects.toMatchObject({key:'budgets.importStale'});await importBudgetCsv(actor,await input('Fresh review'));
 const chart=await getBudgetImportAccounts(actor),bank=chart.find(a=>a.id===W.bank)!;
 await expect(importBudgetCsv(actor,{...data,text:'account_code,annual_target\n1000,1',review:[{accountId:bank.id,accountCode:bank.code,amountCents:'100',stateToken:bank.stateToken}]})).rejects.toMatchObject({key:'budgets.importStale'});
});
it('enforces Accounting write overrides, read-only clamping, immediate revocation and company isolation',async()=>{
 const data=await input('Permission import'),reader={...actor,userId:W.userReader};await expect(getBudgetImportAccounts(reader)).rejects.toMatchObject({key:'forbidden'});await expect(importBudgetCsv(reader,data)).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await importBudgetCsv(reader,data);
 await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(importBudgetCsv(reader,{...data,name:'Denied'})).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(getBudgetImportAccounts(reader)).rejects.toMatchObject({key:'forbidden'});
 const other={userId:W.userOwnerB,companyId:W.companyB};expect((await getBudgetImportAccounts(other)).some(a=>a.id===W.sales)).toBe(false);await expect(importBudgetCsv(other,{...data,fiscalYearId:W.fiscalYearB})).rejects.toMatchObject({key:'budgets.importStale'});expect(await listBudgets(other)).toEqual([]);
});
it('handles concurrent names and rolls back a failed batch including its audit records',async()=>{
 const data=await input('Concurrent import'),n=await count('budget');const result=await Promise.allSettled([importBudgetCsv(actor,data),importBudgetCsv(actor,data)]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(result.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'budgets.duplicate'}});expect(await count('budget')).toBe(n+1);
 const budgets=await count('budget'),lines=await count('budget_line'),audit=await count('audit_log');
 await db.query("CREATE FUNCTION fixture_import_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='00000000-0000-7000-8000-00000000a500'::uuid THEN RAISE EXCEPTION 'fixture failure' USING ERRCODE='AL004'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_import_failure BEFORE INSERT ON budget_line FOR EACH ROW EXECUTE FUNCTION fixture_import_failure()");
 try{await expect(importBudgetCsv(actor,{...data,name:'Must roll back'})).rejects.toThrow();expect(await count('budget')).toBe(budgets);expect(await count('budget_line')).toBe(lines);expect(await count('audit_log')).toBe(audit);}finally{await db.query('DROP TRIGGER fixture_import_failure ON budget_line; DROP FUNCTION fixture_import_failure()');}
});
it('imports French decimals into a different fiscal year without importing previous actuals',async()=>{
 const fy=await createFiscalYear(actor,{containing:'2027-01-01'}),text='account_code;annual_target\n4000;12,34\n5000;0,00',accounts=await getBudgetImportAccounts(actor);
 const id=await importBudgetCsv(actor,{name:'French next year',fiscalYearId:fy.id,format:'fr-CA',text,review:budgetImportReview(previewBudgetCsv(text,'fr-CA',accounts))}),r=await getBudgetComparison(actor,id);expect(r.from).toBe('2027-01-01');expect(r.revenue.targetCents).toBe(1234n);expect(r.revenue.actualCents).toBe(0n);
});
it('supports 1,000 targets and refuses a chart beyond 5,000 accounts without truncating',async()=>{
 await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) SELECT gen_random_uuid(),$1,'CSV-'||lpad(n::text,4,'0'),'Import','Import','EXPENSE','OTHER_EXPENSE',now() FROM generate_series(1,1000) n",[W.companyA]);
 const text='account_code,annual_target\n'+Array.from({length:1000},(_,i)=>`CSV-${String(i+1).padStart(4,'0')},0.01`).join('\n');const year=(await db.query("SELECT id FROM fiscal_year WHERE company_id=$1 AND start_date='2027-01-01'",[W.companyA])).rows[0].id;
 const id=await importBudgetCsv(actor,{...await input('Capacity import',text),fiscalYearId:year});const r=await getBudgetComparison(actor,id);expect(r.rows).toHaveLength(1000);expect(r.expenses.targetCents).toBe(1000n);
 const current=Number((await db.query('SELECT count(*) FROM account WHERE company_id=$1',[W.companyA])).rows[0].count);
 await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) SELECT gen_random_uuid(),$1,'LIMIT-'||lpad(n::text,4,'0'),'Limit','Limit','EXPENSE','OTHER_EXPENSE',now() FROM generate_series(1,$2::int) n",[W.companyA,5000-current]);
 expect(await getBudgetImportAccounts(actor)).toHaveLength(5000);
 await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES(gen_random_uuid(),$1,'OVER-LIMIT','Limit','Limit','EXPENSE','OTHER_EXPENSE',now())",[W.companyA]);
 await expect(getBudgetImportAccounts(actor)).rejects.toMatchObject({key:'budgets.importChartLimit'});
});
