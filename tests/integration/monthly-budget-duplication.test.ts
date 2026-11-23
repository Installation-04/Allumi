import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { createBudget, saveBudgetTarget, getBudgetComparison, getMonthlyAllocation, saveMonthlyAllocation, getMonthlyBudget, getMonthlyBudgetCopyPreview, duplicateMonthlyBudget, duplicateBudget, getBudgetCopyPreview } from "@/modules/budgets";
import { createFiscalYear, postManualEntry } from "@/modules/ledger";
import { owner } from "./helpers";
import { seedWorld, W, inContext, asOwnerA } from "./world";
let db: pg.Client, destinationYear: string, zeroAccount: string;
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const count = async (table: string) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
async function allocate(id: string, accountId: string, values: (bigint | null)[]) {
  const r = await getMonthlyAllocation(actor,id,accountId);
  await saveMonthlyAllocation(actor,id,accountId,{ revision: r.budget.revision, targets: r.periods.map((p,i) => ({ periodId: p.id, amountCents: values[i] ?? null })) });
}
async function source() {
  const id = await createBudget(actor,{ name: 'Source '+randomUUID(), fiscalYearId: W.fiscalYearA });
  for (const [accountId,amountCents] of [[W.sales,30000n],[W.expenses,12000n],[zeroAccount,0n]] as const) {
    await saveBudgetTarget(actor,id,{ accountId,amountCents,revision:(await getBudgetComparison(actor,id)).revision });
  }
  await allocate(id,W.sales,[10001n,0n,...Array<null>(9).fill(null),19999n]);
  await allocate(id,W.expenses,[5000n,...Array<null>(10).fill(null),0n]);
  await allocate(id,zeroAccount,[null,null,0n]);
  return id;
}
async function input(id: string, name = 'Copy '+randomUUID(), fiscalYearId = destinationYear) {
  const p = await getMonthlyBudgetCopyPreview(actor,id,fiscalYearId);
  return { name,fiscalYearId,sourceRevision:p.source.revision,stateToken:p.stateToken,skipInactive:false,confirmed:true as const };
}
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);
  await postManualEntry(actor,{ date:'2026-01-01',kind:'MANUAL',lines:[{accountId:W.bank,debitCents:777n,creditCents:0n},{accountId:W.sales,debitCents:0n,creditCents:777n}] });
  zeroAccount = randomUUID();await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,'MONTH-ZERO','Objectif zéro','Zero target','EXPENSE','OTHER_EXPENSE',now())",[zeroAccount,W.companyA]);
  await db.query('UPDATE company SET fiscal_year_start_month=4 WHERE id=$1',[W.companyA]);
  destinationYear = (await createFiscalYear(actor,{containing:'2027-04-01',now:new Date('2026-11-23T00:00:00Z')})).id;
});
afterAll(async () => { await db?.end(); });
it("previews one snapshot without writes and maps fiscal positions across different calendar months", async () => {
  const id=await source(), before=await count('audit_log'), p=await getMonthlyBudgetCopyPreview(actor,id,destinationYear);
  expect(await count('audit_log')).toBe(before);expect(p).toMatchObject({activeCount:3,inactiveCount:0,monthlyCount:6,annualRevenueCents:30000n,annualExpenseCents:12000n,monthlyRevenueCents:30000n,monthlyExpenseCents:5000n});
  expect(p.mapping).toHaveLength(12);expect(p.mapping[0]).toMatchObject({number:1,source:{from:'2026-01-01',to:'2026-01-31'},destination:{from:'2027-04-01',to:'2027-04-30'}});
  expect(p.mapping[11]).toMatchObject({number:12,destination:{from:'2028-03-01',to:'2028-03-31'}});
  const selection=await getMonthlyBudgetCopyPreview(actor,id);expect(selection.destination).toBeNull();expect(selection.mapping).toEqual([]);
});
it("copies exact annual/monthly targets, zero records and missing periods without altering source or actual entries", async () => {
  const id=await source(), before=await getMonthlyBudgetCopyPreview(actor,id,destinationYear), journals=await count('journal_entry');
  const copied=await duplicateMonthlyBudget(actor,id,await input(id));
  const after=await getMonthlyBudgetCopyPreview(actor,id,destinationYear);expect(after).toEqual(before);expect(await count('journal_entry')).toBe(journals);
  const plan=await getMonthlyBudgetCopyPreview(actor,copied.id,destinationYear);expect(plan.targets.map(r=>[r.accountId,r.amountCents,r.months.map(m=>[m.number,m.amountCents])])).toEqual(before.targets.map(r=>[r.accountId,r.amountCents,r.months.map(m=>[m.number,m.amountCents]) ]));
  const monthly=await getMonthlyAllocation(actor,copied.id,W.sales);expect(monthly.account.months.map(m=>m.targetCents)).toEqual([10001n,0n,...Array<null>(9).fill(null),19999n]);
  expect((await getMonthlyAllocation(actor,copied.id,zeroAccount)).account.months.map(m=>m.targetCents)).toEqual([null,null,0n,...Array<null>(9).fill(null)]);
  const report=await getMonthlyBudget(actor,copied.id,copied.firstPeriodId);expect(report.selected.from).toBe('2027-04-01');expect(report.revenue).toMatchObject({targetCents:10001n,actualCents:0n});
  const event=(await db.query("SELECT actor_user_id,company_id,after FROM audit_log WHERE action='budget.duplicate_monthly' AND entity_id=$1",[copied.id])).rows[0];expect(event).toMatchObject({actor_user_id:actor.userId,company_id:actor.companyId,after:{sourceBudgetId:id,sourceRevision:before.source.revision,copiedTargetCount:3,copiedMonthlyCount:6,excludedAccountIds:[]}});expect(event.after.periods).toHaveLength(12);
  await allocate(copied.id,W.sales,[1n]);expect((await getMonthlyBudgetCopyPreview(actor,id,destinationYear)).targets).toEqual(before.targets);
});
it("keeps annual-only duplication independent and can copy monthly targets within the same fiscal year", async () => {
  const id=await source(), preview=await getBudgetCopyPreview(actor,id);
  const annual=await duplicateBudget(actor,id,{name:'Annual only',fiscalYearId:W.fiscalYearA,sourceRevision:preview.source.revision,stateToken:preview.stateToken,skipInactive:false});
  expect((await getMonthlyBudgetCopyPreview(actor,annual,W.fiscalYearA)).monthlyCount).toBe(0);
  const copied=await duplicateMonthlyBudget(actor,id,await input(id,'Same year',W.fiscalYearA));expect((await getMonthlyBudgetCopyPreview(actor,copied.id,W.fiscalYearA)).monthlyCount).toBe(6);
});
it("requires explicit inactive exclusions and refuses changed eligibility or account labels", async () => {
  const id=await source(), old=await input(id);
  await db.query('UPDATE account SET is_active=false WHERE id=$1',[zeroAccount]);
  try {
    await expect(duplicateMonthlyBudget(actor,id,old)).rejects.toMatchObject({key:'budgets.copyStale'});
    const fresh=await input(id), p=await getMonthlyBudgetCopyPreview(actor,id,destinationYear), n=await count('budget');expect(p).toMatchObject({inactiveCount:1,excludedMonthlyCount:1});
    await expect(duplicateMonthlyBudget(actor,id,fresh)).rejects.toMatchObject({key:'budgets.copyInactive'});expect(await count('budget')).toBe(n);
    const copied=await duplicateMonthlyBudget(actor,id,{...fresh,skipInactive:true});expect((await getMonthlyBudgetCopyPreview(actor,copied.id,destinationYear)).targets).toHaveLength(2);
    await db.query("UPDATE account SET name_en='Changed monthly label' WHERE id=$1",[zeroAccount]);
    await expect(duplicateMonthlyBudget(actor,id,{...fresh,name:'Stale label',skipInactive:true})).rejects.toMatchObject({key:'budgets.copyStale'});
  } finally {await db.query("UPDATE account SET is_active=true,name_en='Zero target' WHERE id=$1",[zeroAccount]);}
});
it("refuses changed monthly source revisions, different destinations, invalid consent and tampered state", async () => {
  const id=await source(), old=await input(id), n=await count('budget');await allocate(id,W.sales,[99n,0n]);
  await expect(duplicateMonthlyBudget(actor,id,old)).rejects.toMatchObject({key:'budgets.copyStale'});
  const fresh=await input(id);
  await expect(duplicateMonthlyBudget(actor,id,{...fresh,fiscalYearId:W.fiscalYearA})).rejects.toMatchObject({key:'budgets.copyStale'});
  await expect(duplicateMonthlyBudget(actor,id,{...fresh,stateToken:'0'.repeat(64)})).rejects.toMatchObject({key:'budgets.copyStale'});
  await expect(duplicateMonthlyBudget(actor,id,{...fresh,confirmed:false as unknown as true})).rejects.toMatchObject({key:'budgets.invalid'});
  expect(await count('budget')).toBe(n);
});
it("enforces Accounting write overrides and keeps users and companies isolated", async () => {
  const id=await source(), data=await input(id), n=await count('budget');
  await expect(getMonthlyBudgetCopyPreview(reader,id,destinationYear)).rejects.toMatchObject({key:'forbidden'});
  const other={userId:W.userOwnerB,companyId:W.companyB};await expect(getMonthlyBudgetCopyPreview(other,id,W.fiscalYearB)).rejects.toMatchObject({key:'budgets.notFound'});
  await expect(duplicateMonthlyBudget(other,id,{...data,fiscalYearId:W.fiscalYearB})).rejects.toMatchObject({key:'budgets.notFound'});
  await expect(getMonthlyBudgetCopyPreview(actor,id,W.fiscalYearB)).rejects.toMatchObject({key:'budgets.year'});
  await expect(duplicateMonthlyBudget(actor,id,{...data,fiscalYearId:W.fiscalYearB})).rejects.toMatchObject({key:'budgets.year'});
  expect(await count('budget')).toBe(n);
  await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
  try {
    const p=await getMonthlyBudgetCopyPreview(reader,id,destinationYear);
    await expect(duplicateMonthlyBudget(reader,id,data)).rejects.toMatchObject({key:'budgets.copyStale'});
    await duplicateMonthlyBudget(reader,id,{...data,stateToken:p.stateToken});
    await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
    await expect(duplicateMonthlyBudget(reader,id,{...data,name:'Forbidden read only'})).rejects.toMatchObject({key:'forbidden'});
  } finally {await db.query("UPDATE membership SET role='READ_ONLY',module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);}
});
it("serializes duplicate names and rolls back annual rows, monthly rows and audit on an injected monthly failure", async () => {
  const id=await source(), data=await input(id,'Concurrent monthly'), before=await count('budget');
  const outcomes=await Promise.allSettled([duplicateMonthlyBudget(actor,id,data),duplicateMonthlyBudget(actor,id,data)]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(outcomes.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'budgets.duplicate'}});expect(await count('budget')).toBe(before+1);
  const tableCounts=async()=>{const values=[];for(const table of ['budget','budget_line','budget_monthly_target','audit_log'])values.push(await count(table));return values;};
  const counts=await tableCounts();
  await db.query("CREATE FUNCTION fixture_month_copy_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT period_number FROM fiscal_period WHERE id=NEW.fiscal_period_id)=2 THEN RAISE EXCEPTION 'fixture monthly copy failure' USING ERRCODE='AL004'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_month_copy_failure BEFORE INSERT ON budget_monthly_target FOR EACH ROW EXECUTE FUNCTION fixture_month_copy_failure()");
  try {await expect(duplicateMonthlyBudget(actor,id,{...data,name:'Must roll back monthly'})).rejects.toThrow();expect(await tableCounts()).toEqual(counts);}
  finally {await db.query('DROP TRIGGER fixture_month_copy_failure ON budget_monthly_target; DROP FUNCTION fixture_month_copy_failure()');}
});
it("rechecks the source revision after waiting for an in-flight monthly edit", async () => {
  const id=await source(), data=await input(id), n=await count('budget'), first=await owner();
  let outcome: Promise<{error?:unknown}> | undefined;
  try {
    await first.query('BEGIN');await first.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[W.userOwnerA,W.companyA]);
    const pid=(await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await first.query('UPDATE budget_monthly_target SET amount_cents=9999 WHERE budget_line_id=(SELECT id FROM budget_line WHERE budget_id=$1 AND account_id=$2) AND fiscal_period_id=(SELECT id FROM fiscal_period WHERE fiscal_year_id=$3 AND period_number=1)',[id,W.sales,W.fiscalYearA]);
    outcome=duplicateMonthlyBudget(actor,id,data).then(()=>({}),error=>({error}));
    let blocked=false;for(let i=0;i<100;i++){blocked=(await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS ok',[pid])).rows[0].ok;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,20));}expect(blocked).toBe(true);
    await first.query('COMMIT');expect((await outcome).error).toMatchObject({key:'budgets.copyStale'});expect(await count('budget')).toBe(n);
  } finally {await first.query('ROLLBACK');await first.end();if(outcome)await outcome;}
});
it("copies empty allocations in closed fiscal periods without posting or reopening them", async () => {
  const empty=await createBudget(actor,{name:'Empty monthly source',fiscalYearId:W.fiscalYearA});
  await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND fiscal_year_id=$3",[W.companyA,W.userOwnerA,destinationYear]);
  const journals=await count('journal_entry'),copied=await duplicateMonthlyBudget(actor,empty,await input(empty));expect((await getMonthlyBudgetCopyPreview(actor,copied.id,destinationYear)).targets).toEqual([]);expect(await count('journal_entry')).toBe(journals);
  expect((await db.query("SELECT count(*)::int AS n FROM fiscal_period WHERE fiscal_year_id=$1 AND status='LOCKED'",[destinationYear])).rows[0].n).toBe(12);
});
it("requires all twelve destination periods instead of producing a partial mapping", async () => {
  const id=await source(), year=randomUUID();await db.query("INSERT INTO fiscal_year(id,company_id,start_date,end_date) VALUES($1,$2,'2029-04-01','2030-03-31')",[year,W.companyA]);
  await expect(getMonthlyBudgetCopyPreview(actor,id,year)).rejects.toMatchObject({key:'budgets.monthlyPeriods'});
});

it("copies 1,000 annual accounts and 12,000 monthly rows, and refuses oversized sources or destination coverage", async () => {
  const id=await createBudget(actor,{name:'Capacity monthly source',fiscalYearId:W.fiscalYearA});
  await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) SELECT gen_random_uuid(),$1,'MCP81-'||lpad(n::text,4,'0'),'Capacité mensuelle','Monthly capacity','EXPENSE','OTHER_EXPENSE',now() FROM generate_series(1,1001) n",[W.companyA]);
  await inContext(db,asOwnerA,()=>db.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,$2,id,12,now() FROM account WHERE company_id=$1 AND code LIKE 'MCP81-%' ORDER BY code LIMIT 1000",[W.companyA,id]),{commit:true});
  await inContext(db,asOwnerA,()=>db.query('INSERT INTO budget_monthly_target(id,company_id,budget_line_id,fiscal_period_id,amount_cents,updated_at) SELECT gen_random_uuid(),l.company_id,l.id,p.id,1,now() FROM budget_line l JOIN fiscal_period p ON p.company_id=l.company_id AND p.fiscal_year_id=$3 WHERE l.company_id=$1 AND l.budget_id=$2',[W.companyA,id,W.fiscalYearA]),{commit:true});
  const p=await getMonthlyBudgetCopyPreview(actor,id,destinationYear);expect(p).toMatchObject({activeCount:1000,monthlyCount:12000});
  const copied=await duplicateMonthlyBudget(actor,id,{name:'Capacity monthly copy',fiscalYearId:destinationYear,sourceRevision:p.source.revision,stateToken:p.stateToken,skipInactive:false,confirmed:true});
  expect((await getMonthlyBudgetCopyPreview(actor,copied.id,destinationYear)).monthlyCount).toBe(12000);
  // Fail after half the copied accounts: earlier monthly batches must also disappear.
  const lateAccount=p.targets[500]!.accountId;
  expect(lateAccount).toMatch(/^[0-9a-f-]{36}$/);
  const counts=[];for(const table of ['budget','budget_line','budget_monthly_target','audit_log'])counts.push(await count(table));
  await db.query("CREATE FUNCTION fixture_late_month_copy_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM budget_line WHERE id=NEW.budget_line_id AND account_id=TG_ARGV[0]::uuid) THEN RAISE EXCEPTION 'fixture late monthly copy failure' USING ERRCODE='AL004'; END IF; RETURN NEW; END $$");
  await db.query(`CREATE TRIGGER fixture_late_month_copy_failure BEFORE INSERT ON budget_monthly_target FOR EACH ROW EXECUTE FUNCTION fixture_late_month_copy_failure('${lateAccount}')`);
  try {
    await expect(duplicateMonthlyBudget(actor,id,{name:'Capacity late rollback',fiscalYearId:destinationYear,sourceRevision:p.source.revision,stateToken:p.stateToken,skipInactive:false,confirmed:true})).rejects.toThrow();
    const after=[];for(const table of ['budget','budget_line','budget_monthly_target','audit_log'])after.push(await count(table));expect(after).toEqual(counts);
  } finally {await db.query('DROP TRIGGER fixture_late_month_copy_failure ON budget_monthly_target; DROP FUNCTION fixture_late_month_copy_failure()');}
  // The existing sales activity also occupies a report row in the source year.
  await expect(getMonthlyBudgetCopyPreview(actor,id,W.fiscalYearA)).rejects.toMatchObject({key:'budgets.tooMany'});
  const n=await count('budget');await expect(duplicateMonthlyBudget(actor,id,{name:'Coverage overflow',fiscalYearId:W.fiscalYearA,sourceRevision:p.source.revision,stateToken:p.stateToken,skipInactive:false,confirmed:true})).rejects.toMatchObject({key:'budgets.tooMany'});expect(await count('budget')).toBe(n);
  await inContext(db,asOwnerA,()=>db.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,$2,id,12,now() FROM account WHERE company_id=$1 AND code='MCP81-1001'",[W.companyA,id]),{commit:true});
  await expect(getMonthlyBudgetCopyPreview(actor,id,destinationYear)).rejects.toMatchObject({key:'budgets.tooMany'});
},180000);
