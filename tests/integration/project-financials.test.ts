import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import type pg from 'pg';
import { createProject, getProject, setProjectArchived, assignProjectEntry, previewProjectAssignment, getEntryProjectAssignment, getProjectFinance, financeCsv } from '@/modules/projects';
import { postManualEntry, reverseEntry, lockPeriod } from '@/modules/ledger';
import { owner } from './helpers';
import { W, seedWorld, appClient, inContext, asOwnerA, sqlstate } from './world';
let db: pg.Client, app: pg.Client;
const a = { userId: W.userOwnerA, companyId: W.companyA }, b = { userId: W.userOwnerB, companyId: W.companyB }, reader = { ...a, userId: W.userReader }, accountant = { ...a, userId: W.userAccountant };
const f = { from: '2026-03-01', to: '2026-03-31', page: 1 };
const project = (code: string) => createProject(a, { code, name: `Projet ${code}`, description: '' });
const post = (date: string, debit: string, credit: string, cents: bigint) => postManualEntry(a, { date, kind: 'MANUAL', memo: 'PRIVATE memo not exposed by project reports', lines: [{ accountId: debit, debitCents: cents, creditCents: 0n }, { accountId: credit, debitCents: 0n, creditCents: cents }] });
const ledger = async () => (await db.query('SELECT (SELECT jsonb_agg(e ORDER BY id) FROM journal_entry e) AS entries,(SELECT jsonb_agg(l ORDER BY id) FROM journal_line l) AS lines')).rows;
beforeAll(async () => { db = await owner(); await seedWorld(db); app = await appClient(); await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5)", [W.companyA]); });
afterAll(async () => { await app?.end(); await db?.end(); });

it('resolves an original and its counter to one current classification without ledger or audit writes', async () => {
  const id=await project('JOURNAL114'),sale=await post('2026-03-01',W.bank,W.sales,12345n),counter=await reverseEntry(a,sale.id,{date:'2026-03-02'});
  const unassigned=await getEntryProjectAssignment(reader,counter.id);expect(unassigned).toMatchObject({entryId:sale.id,number:String(sale.number),inherited:true,projectId:null,revision:0});
  await assignProjectEntry(a,id,sale.id,0,false,true);
  const before=await ledger(),audit=(await db.query('SELECT count(*)::text AS n FROM audit_log')).rows[0].n;
  const original=await getEntryProjectAssignment(reader,sale.id),reversal=await getEntryProjectAssignment(reader,counter.id);
  expect(original).toMatchObject({entryId:sale.id,projectId:id,code:'JOURNAL114',revision:1,inherited:false,revenue:12345n});expect(reversal).toEqual({...original,inherited:true});
  expect(Object.keys(reversal).sort()).toEqual(['entryId','number','date','revenue','expenses','revision','projectId','code','name','inherited'].sort());
  expect(await ledger()).toEqual(before);expect((await db.query('SELECT count(*)::text AS n FROM audit_log')).rows[0].n).toBe(audit);
});
it('refuses unavailable sources without exposing foreign entries or balance-only originals', async () => {
  const e=await post('2026-03-03',W.bank,W.capital,100n),sale=await post('2026-03-03',W.bank,W.sales,100n);
  for(const [who,id] of [[a,e.id],[b,sale.id],[a,'not-a-uuid'],[a,randomUUID()]] as const)await expect(getEntryProjectAssignment(who,id)).rejects.toMatchObject({key:'projectFinance.entryUnavailable'});
});
it('resolves archived and detached classifications at their current revision including stale preview refusal',async()=>{
  const id=await project('HISTORY114'),sale=await post('2026-03-04',W.bank,W.sales,100n),counter=await reverseEntry(a,sale.id,{date:'2026-03-05'});
  await assignProjectEntry(a,id,sale.id,0,false,true);const preview=await getEntryProjectAssignment(a,counter.id);
  await setProjectArchived(a,id,1,true,true);expect((await getEntryProjectAssignment(reader,counter.id)).code).toBe('HISTORY114');
  await assignProjectEntry(a,id,sale.id,1,true,true);expect(await getEntryProjectAssignment(reader,counter.id)).toMatchObject({projectId:null,revision:2,inherited:true});
  await expect(assignProjectEntry(a,id,preview.entryId,preview.revision,true,true)).rejects.toMatchObject({key:'projectFinance.stale'});
});
it('reads classifications without directory/sales permissions and denies a revoked Accounting module',async()=>{
  const sale=await post('2026-03-06',W.bank,W.sales,100n);
  await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"read\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant]);
  try{expect(await getEntryProjectAssignment(accountant,sale.id)).toMatchObject({projectId:null,inherited:false});await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant]);await expect(getEntryProjectAssignment(accountant,sale.id)).rejects.toMatchObject({key:'forbidden'});}finally{await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant]);}
});
it('classifies whole immutable entries and includes counters on their own dates with exact signed cents', async () => {
  const id = await project('SCOPE113'), sale = await post('2026-02-28', W.bank, W.sales, 12345n), expense = await post('2026-03-01', W.expenses, W.bank, 2345n), credit = await post('2026-03-31', W.sales, W.bank, 111n);
  const reversed = await reverseEntry(a, sale.id, { date: '2026-03-15' }), before = await ledger();
  for (const e of [sale, expense, credit]) await assignProjectEntry(a, id, e.id, 0, false, true);
  const r = await getProjectFinance(reader, id, f, 'export');
  expect(r).toMatchObject({ count: 3, revenue: -12456n, expenses: 2345n });
  expect(r.rows.find(x => x.id === reversed.id)).toMatchObject({ reversed: true, date: '2026-03-15', rootNumber: String(sale.number), revenue: -12345n });
  expect((await getProjectFinance(a, id, { ...f, from: '2026-02-01' })).revenue).toBe(-111n);
  const preview = await previewProjectAssignment(reader, String(sale.number)); expect(preview).toMatchObject({ projectId: id, revision: 1, revenue: 12345n });
  expect(JSON.stringify(preview, (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('PRIVATE');
  expect(financeCsv(r, 'en', k => k)).toContain('-124.56');
  expect(await ledger()).toEqual(before);
  expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='project_entry_assignment' AND (\"after\"->>'project_id')=$1", [id])).rows[0].n).toBe(3);
});
it('requires confirmation, rejects balance-only entries and direct reversal classification, and isolates tenants', async () => {
  const id = await project('GUARD113'), sale = await post('2026-03-03', W.bank, W.sales, 900n), capital = await post('2026-03-03', W.bank, W.capital, 900n), counter = await reverseEntry(a, sale.id, { date: '2026-03-04' });
  await expect(assignProjectEntry(a, id, sale.id, 0, false, false)).rejects.toMatchObject({ key: 'projectFinance.confirm' });
  for (const e of [capital, counter]) await expect(assignProjectEntry(a, id, e.id, 0, false, true)).rejects.toMatchObject({ key: 'projectFinance.entryUnavailable' });
  await expect(previewProjectAssignment(b, String(sale.number))).rejects.toMatchObject({ key: 'projectFinance.entryUnavailable' });
  await expect(getProjectFinance(b, id, f)).rejects.toMatchObject({ key: 'project.notFound' });
  await expect(assignProjectEntry(b, id, sale.id, 0, false, true)).rejects.toMatchObject({ key: 'project.notFound' });
  for (const e of [capital, counter]) expect(await sqlstate(() => inContext(app, asOwnerA, () => app.query('INSERT INTO project_entry_assignment(id,company_id,entry_id,project_id,updated_at) VALUES($1,$2,$3,$4,now())', [randomUUID(), W.companyA, e.id, id])))).toBe('AL004');
});
it('retains revisions on detach and rejects stale reassignment including concurrent first assignments', async () => {
  const p = await project('RACE113'), q = await project('MOVE113'), sale = await post('2026-03-05', W.bank, W.sales, 400n), before = await ledger();
  const results = await Promise.allSettled([p, q].map(id => assignProjectEntry(a, id, sale.id, 0, false, true)));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { key: 'projectFinance.stale' } });
  const current = await previewProjectAssignment(a, String(sale.number)), next = current.projectId === p ? q : p;
  await assignProjectEntry(a, next, sale.id, 1, false, true);
  expect((await getProjectFinance(a, current.projectId!, f)).count).toBe(0);
  await expect(assignProjectEntry(a, next, sale.id, 1, true, true)).rejects.toMatchObject({ key: 'projectFinance.stale' });
  await assignProjectEntry(a, next, sale.id, 2, true, true);
  expect(await previewProjectAssignment(a, String(sale.number))).toMatchObject({ revision: 3, projectId: null });
  await expect(assignProjectEntry(a, p, sale.id, 0, false, true)).rejects.toMatchObject({ key: 'projectFinance.stale' });
  await assignProjectEntry(a, p, sale.id, 3, false, true);
  expect(await ledger()).toEqual(before);
});
it('keeps archived project reports readable and allows detach while refusing new classifications', async () => {
  const id = await project('ARCH113'), sale = await post('2026-03-06', W.bank, W.sales, 100n), other = await post('2026-03-06', W.bank, W.sales, 200n);
  await assignProjectEntry(a, id, sale.id, 0, false, true); await setProjectArchived(a, id, 1, true, true);
  expect((await getProjectFinance(reader, id, f)).revenue).toBe(100n);
  await expect(assignProjectEntry(a, id, other.id, 0, false, true)).rejects.toMatchObject({ key: 'project.archived' });
  await assignProjectEntry(a, id, sale.id, 1, true, true); expect((await getProjectFinance(a, id, f)).count).toBe(0);
});
it('enforces Accounting independently of Contacts/Sales/Taxes/Audit and caps read-only membership', async () => {
  const id = await project('ROLE113'), sale = await post('2026-03-07', W.bank, W.sales, 300n);
  await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
  try {
    await assignProjectEntry(accountant, id, sale.id, 0, false, true); expect((await getProjectFinance(accountant, id, f)).revenue).toBe(300n);
    await expect(assignProjectEntry(reader, id, sale.id, 1, true, true)).rejects.toMatchObject({ key: 'forbidden' });
    await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    await expect(previewProjectAssignment(accountant, String(sale.number))).rejects.toMatchObject({ key: 'forbidden' });
    expect((await inContext(app, { userId: W.userAccountant, companyId: W.companyA }, () => app.query('SELECT * FROM project_entry_assignment'))).rowCount).toBe(0);
  } finally { await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]); }
});
it('forbids assignment deletion and mutation of its entry or revision even through raw SQL', async () => {
  const id = await project('SQL113'), sale = await post('2026-03-08', W.bank, W.sales, 400n); await assignProjectEntry(a, id, sale.id, 0, false, true);
  for (const query of ['DELETE FROM project_entry_assignment WHERE entry_id=$1', 'UPDATE project_entry_assignment SET revision=revision+1 WHERE entry_id=$1', 'UPDATE project_entry_assignment SET entry_id=gen_random_uuid(),revision=revision+1 WHERE entry_id=$1']) expect(await sqlstate(() => inContext(app, asOwnerA, () => app.query(query, [sale.id])))).toMatch(/AL004|42501/);
  expect((await getProject(a, id)).status).toBe('ACTIVE');
});
it('serializes archival with new classifications at the database boundary', async () => {
  const id = await project('LOCK113'), sale = await post('2026-03-09', W.bank, W.sales, 1n), lock = await owner();
  await lock.query('BEGIN');
  try {
    await lock.query("UPDATE project SET status='ARCHIVED',revision=revision+1 WHERE id=$1", [id]);
    const pending = assignProjectEntry(a, id, sale.id, 0, false, true).then(() => 'accepted', () => 'refused');
    await lock.query('COMMIT'); expect(await pending).toBe('refused');
    expect((await getProjectFinance(reader, id, f)).count).toBe(0);
  } finally { await lock.query('ROLLBACK'); await lock.end(); }
});
it('changes only analytical classification in locked periods, leaving financial data and period status intact', async () => {
  const p = await project('CLOSED113'), q = await project('CLOSEDMOVE113'), sale = await post('2026-01-15', W.bank, W.sales, 123n);
  const period = (await db.query('SELECT id FROM fiscal_period WHERE company_id=$1 AND period_number=1', [W.companyA])).rows[0].id;
  await lockPeriod(a, period); const before = await ledger();
  await assignProjectEntry(a, p, sale.id, 0, false, true); await assignProjectEntry(a, q, sale.id, 1, false, true);
  expect((await getProjectFinance(reader, p, { ...f, from: '2026-01-01', to: '2026-01-31' })).revenue).toBe(0n);
  expect((await getProjectFinance(reader, q, { ...f, from: '2026-01-01', to: '2026-01-31' })).revenue).toBe(123n);
  expect((await db.query('SELECT status FROM fiscal_period WHERE id=$1', [period])).rows[0].status).toBe('LOCKED'); expect(await ledger()).toEqual(before);
});
it('pages all classified entries consistently and rejects partial print/CSV above exact caps without read-side audit', async () => {
  const id = await project('CAP113');
  const bulk = async (start: number, count: number) => inContext(db, asOwnerA, async () => {
    await db.query("INSERT INTO journal_entry(id,company_id,entry_number,entry_date,fiscal_period_id,source_type,created_by_id) SELECT gen_random_uuid(),$1,100000+n,DATE '2026-03-10',fp.id,'MANUAL',$2 FROM generate_series($3::int,$4::int)n CROSS JOIN fiscal_period fp WHERE fp.company_id=$1 AND fp.period_number=3", [W.companyA, W.userOwnerA, start, start + count - 1]);
    for (const [no, account, debit, credit] of [[1, W.bank, 1, 0], [2, W.sales, 0, 1]] as const) await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date) SELECT gen_random_uuid(),$1,e.id,$2,$3,$4,$5,e.entry_date FROM journal_entry e WHERE e.company_id=$1 AND e.entry_number BETWEEN $6 AND $7", [W.companyA, no, account, debit, credit, 100000 + start, 100000 + start + count - 1]);
    await db.query('INSERT INTO project_entry_assignment(id,company_id,entry_id,project_id,updated_at) SELECT gen_random_uuid(),$1,e.id,$2,now() FROM journal_entry e WHERE e.company_id=$1 AND e.entry_number BETWEEN $3 AND $4', [W.companyA, id, 100000 + start, 100000 + start + count - 1]);
  }, { commit: true });
  await bulk(1, 1000); expect((await getProjectFinance(reader, id, f, 'print')).rows).toHaveLength(1000);
  await bulk(1001, 4000); const audit = async () => (await db.query('SELECT count(*)::text AS n FROM audit_log')).rows[0].n, before = await audit();
  const complete = await getProjectFinance(reader, id, f, 'export'); expect(complete).toMatchObject({ count: 5000, revenue: 5000n }); expect(complete.rows).toHaveLength(5000);
  const last = await getProjectFinance(reader, id, { ...f, page: 999 }); expect(last).toMatchObject({ page: 100, pages: 100, count: 5000 }); expect(last.rows).toHaveLength(50); expect(last.rows[49]?.number).toBe('100001');
  await expect(getProjectFinance(reader, id, f, 'print')).rejects.toMatchObject({ key: 'projectFinance.printLimit' }); expect(await audit()).toBe(before);
  await bulk(5001, 1); await expect(getProjectFinance(reader, id, f, 'export')).rejects.toMatchObject({ key: 'projectFinance.exportLimit' });
  expect((await getProjectFinance(reader, id, { ...f, from: '2026-03-11' })).count).toBe(0);
}, 60000);
