import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { previewMigration, confirmMigration, migrationHistory, type MigrationSpec } from "@/modules/migration";
import { postManualEntry } from "@/modules/ledger";
import { owner } from "./helpers";
import { W, seedWorld, appClient, inContext, asOwnerA, asReader, asAccountant, sqlstate } from "./world";
let db: pg.Client, app: pg.Client;
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const base: MigrationSpec = { source: "ONLINE", kind: "CUSTOMERS", delimiter: ",", format: "en", headerRecord: 1, mapping: { name: 0, email: 1 }, defaultLocale: "en", skipExisting: false, cutoverDate: "" };
const financial: MigrationSpec = { ...base, kind: "BALANCES", mapping: { code: 0, debit: 1, credit: 2 }, cutoverDate: "2026-01-31" };
const csv = (name: string) => `Name,Email\n${name},customer@example.test`;
const target = 'Code,Debit,Credit\n1000,100.00,0\n3000,0,100.00\n1100,0,0\n2100,0,0';
const count = async (table: string) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
const post = (date: string, amount: bigint) => postManualEntry(actor, { date, kind: "MANUAL", lines: [{ accountId: W.bank, debitCents: amount, creditCents: 0n }, { accountId: W.capital, debitCents: 0n, creditCents: amount }] });
beforeAll(async () => {
 db = await owner(); await seedWorld(db); app = await appClient();
 await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($2,'JOURNAL_ENTRY',1,'J-',5)", [W.companyA, W.companyB]);
 await post("2026-01-01", 1000n);
});
afterAll(async () => { await app?.end(); await db?.end(); });
it("previews without writes, then creates contacts atomically with metadata/provenance and no source file", async () => {
 const before = await count('audit_log'), text = csv('QB Customer');
 const p = await previewMigration(actor, text, base); expect(p.ready).toBe(true); expect(await count('audit_log')).toBe(before);
 const result = await confirmMigration(actor, text, base, p.token, true);
 expect(result).toMatchObject({ createdCount: 1, skippedCount: 0, journalEntryId: null });
 const contact = (await db.query("SELECT * FROM contact WHERE display_name='QB Customer'")).rows[0];expect(contact).toMatchObject({ is_customer: true, is_supplier: false, locale: 'en' });
 const batch = (await migrationHistory(actor)).find(b => b.id === result.id)!;expect(batch.sourceDigest).toMatch(/^[a-f0-9]{64}$/);expect(Object.keys(batch)).not.toContain('file');
 const event = (await db.query('SELECT "after" FROM audit_log WHERE action=\'migration.import\' AND entity_id=$1', [result.id])).rows[0];
 expect(JSON.stringify(event)).not.toContain('customer@example.test');expect(JSON.stringify(event)).toContain(contact.id);
 await expect(previewMigration(actor, text, { ...base, source: 'DESKTOP' })).rejects.toMatchObject({ key: 'migration.alreadyImported' });
});
it("requires explicit skip, keeps existing values and blocks cross-role matches", async () => {
 const text = 'Name,Email\nQB Customer,changed@example.test\nQB New,new@example.test';
 expect((await previewMigration(actor, text, base)).ready).toBe(false);
 const spec = { ...base, skipExisting: true }, p = await previewMigration(actor, text, spec);expect(p).toMatchObject({ ready: true, createdCount: 1, skippedCount: 1 });
 await confirmMigration(actor, text, spec, p.token, true);
 expect((await db.query("SELECT email FROM contact WHERE display_name='QB Customer'")).rows[0].email).toBe('customer@example.test');
 const opposite = await previewMigration(actor, csv('QB Customer'), { ...base, kind: 'SUPPLIERS', skipExisting: true });expect(opposite.rows[0]).toMatchObject({ status: 'CONFLICT', reason: 'kind' });
});
it("refuses tampered files/options, missing consent, expired signatures and changed destination records", async () => {
 const text = csv('QB Bound'), p = await previewMigration(actor, text, base);
 await expect(confirmMigration(actor, csv('QB Other'), base, p.token, true)).rejects.toMatchObject({ key: 'migration.stale' });
 await expect(confirmMigration(actor, text, { ...base, source: 'DESKTOP' }, p.token, true)).rejects.toMatchObject({ key: 'migration.stale' });
 await expect(confirmMigration(actor, text, base, p.token, false)).rejects.toMatchObject({ key: 'migration.confirm' });
 await expect(confirmMigration(actor, text, base, '1000000000000.' + '0'.repeat(64), true)).rejects.toMatchObject({ key: 'migration.stale' });
 await db.query("UPDATE contact SET email='updated@example.test' WHERE display_name='QB New'");
 await expect(confirmMigration(actor, text, base, p.token, true)).rejects.toMatchObject({ key: 'migration.stale' });
 expect((await db.query("SELECT id FROM contact WHERE display_name='QB Bound'")).rowCount).toBe(0);
});
it("isolates tenant and author, and refuses non-administrators even with write overrides", async () => {
 const text = csv('QB Isolated'), p = await previewMigration(actor, text, base);
 for (const userId of [W.userReader, W.userAccountant]) await expect(previewMigration({ ...actor, userId }, text, base)).rejects.toMatchObject({ key: 'forbidden' });
 await expect(previewMigration({ userId: W.userOwnerB, companyId: W.companyA }, text, base)).rejects.toMatchObject({ key: 'forbidden' });
 await expect(confirmMigration({ userId: W.userOwnerB, companyId: W.companyB }, text, base, p.token, true)).rejects.toMatchObject({ key: 'migration.stale' });
 const newOwner = randomUUID();await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES($1,'second-owner@example.test','Second',now());", [newOwner]);await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())", [W.companyA, newOwner]);
 await expect(confirmMigration({ ...actor, userId: newOwner }, text, base, p.token, true)).rejects.toMatchObject({ key: 'migration.stale' });
});
it("serializes duplicate confirmations and inserts one batch and one contact", async () => {
 const text = csv('QB Concurrent'), a = await previewMigration(actor, text, base), b = await previewMigration(actor, text, base);
 const result = await Promise.allSettled([confirmMigration(actor, text, base, a.token, true), confirmMigration(actor, text, base, b.token, true)]);
 expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);expect(result.find(r => r.status === 'rejected')).toMatchObject({ reason: { key: 'migration.alreadyImported' } });
 expect((await db.query("SELECT id FROM contact WHERE display_name='QB Concurrent'")).rowCount).toBe(1);
});
it("rolls back contacts, history and audit when any row insertion fails", async () => {
 const text = 'Name,Email\nQB Failure1,a@example.test\nQB Failure2,b@example.test', p = await previewMigration(actor, text, base), before = await count('audit_log'), batches = await count('migration_batch');
 await db.query("CREATE FUNCTION fixture_import_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.display_name='QB Failure2' THEN RAISE EXCEPTION 'fixture' USING ERRCODE='AL004'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_import_failure BEFORE INSERT ON contact FOR EACH ROW EXECUTE FUNCTION fixture_import_failure()");
 try { await expect(confirmMigration(actor, text, base, p.token, true)).rejects.toThrow(); expect(await count('audit_log')).toBe(before);expect(await count('migration_batch')).toBe(batches);expect((await db.query("SELECT id FROM contact WHERE display_name LIKE 'QB Failure%'")).rowCount).toBe(0); }
 finally { await db.query('DROP TRIGGER fixture_import_failure ON contact; DROP FUNCTION fixture_import_failure()'); }
});
it("resolves catalog references by company code, preserves six decimals and refuses reserved account creation", async () => {
 const spec: MigrationSpec = { ...base, kind: 'ITEMS', mapping: { name: 0, price: 1, incomeAccount: 2, taxCode: 3 } }, text = 'Name,Price,Income account,Tax code\nQB Service,12.345678,4000,TPS+TVQ';
 const p = await previewMigration(actor, text, spec);expect(p.ready).toBe(true);await confirmMigration(actor, text, spec, p.token, true);
 expect((await db.query("SELECT unit_price::text, income_account_id,default_tax_code_id FROM item WHERE name='QB Service'")).rows[0]).toMatchObject({ unit_price: '12.345678', income_account_id: W.sales, default_tax_code_id: W.taxCodeStandard });
 expect((await previewMigration(actor, text.replace('QB Service', 'QB Invalid').replace('4000', '1000'), spec)).rows[0]?.status).toBe('CONFLICT');
 const accounts: MigrationSpec = { ...base, kind: 'ACCOUNTS', mapping: { name: 0, code: 1, accountType: 2 } };
 const reserved = await previewMigration(actor, 'Name,Code,Type\nImported AR,QB1100,Accounts receivable', accounts);expect(reserved.rows[0]).toMatchObject({ status: 'CONFLICT', reason: 'reserved' });
 const bank = await previewMigration(actor, 'Name,Code,Type\nQB Bank,QB1000,Bank', accounts);await confirmMigration(actor, 'Name,Code,Type\nQB Bank,QB1000,Bank', accounts, bank.token, true);
 expect((await db.query("SELECT type,subtype,system_key FROM account WHERE code='QB1000'")).rows[0]).toEqual({ type: 'ASSET', subtype: 'BANK', system_key: null });
});
it("rejects direct SQL for another tenant/author/role and keeps batch history immutable", async () => {
 const insert = (user: string = W.userOwnerA, company: string = W.companyA) => app.query("INSERT INTO migration_batch(id,company_id,created_by_id,source,kind,fingerprint,source_digest,row_count,created_count,skipped_count) VALUES(gen_random_uuid(),$1,$2,'ONLINE','CUSTOMERS',$3,$4,1,1,0)", [company, user, 'a'.repeat(64), 'b'.repeat(64)]);
 expect(await sqlstate(() => inContext(app, asOwnerA, () => insert(W.userOwnerB)))).toBe('42501');
 expect(await sqlstate(() => inContext(app, asOwnerA, () => insert(W.userOwnerA, W.companyB)))).toBe('42501');
 for (const ctx of [asReader, asAccountant]) expect(await sqlstate(() => inContext(app, ctx, () => insert()))).toBe('42501');
 expect((await inContext(app, asReader, () => app.query('SELECT id FROM migration_batch'))).rowCount).toBe(0);
 expect(await sqlstate(() => db.query("UPDATE migration_batch SET source='DESKTOP'"))).toBe('AL004');expect(await sqlstate(() => db.query('TRUNCATE migration_batch'))).toBe('AL004');
});
it("rejects incomplete balances, control differences, closed periods and stale ledger previews", async () => {
 await expect(previewMigration(actor, 'Code,Debit,Credit\n4000,0,0', financial)).rejects.toMatchObject({ key: 'migration.coverage' });
 const controls = await previewMigration(actor, 'Code,Debit,Credit\n1000,10.00,0\n1100,1.00,0\n3000,0,11.00', financial);expect(controls.rows.find(r => r.source.key === '1100')).toMatchObject({ status: 'CONFLICT', reason: 'controls' });
 await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=2", [W.companyA, W.userOwnerA]);
 await expect(previewMigration(actor, target, { ...financial, cutoverDate: '2026-02-28' })).rejects.toMatchObject({ key: 'migration.period' });
 const p = await previewMigration(actor, target, financial);await post('2026-01-02', 100n);
 await expect(confirmMigration(actor, target, financial, p.token, true)).rejects.toMatchObject({ key: 'migration.stale' });
});
it("rolls back a posted adjustment and its number when batch persistence fails", async () => {
 const p = await previewMigration(actor, target, financial), entries = await count('journal_entry'), audits = await count('audit_log'), number = (await db.query("SELECT next_value FROM number_sequence WHERE company_id=$1 AND key='JOURNAL_ENTRY'", [W.companyA])).rows[0].next_value;
 await db.query("CREATE FUNCTION fixture_balance_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='BALANCES' THEN RAISE EXCEPTION 'fixture' USING ERRCODE='AL004'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_balance_failure BEFORE INSERT ON migration_batch FOR EACH ROW EXECUTE FUNCTION fixture_balance_failure()");
 try { await expect(confirmMigration(actor, target, financial, p.token, true)).rejects.toThrow();expect(await count('journal_entry')).toBe(entries);expect(await count('audit_log')).toBe(audits);expect((await db.query("SELECT next_value FROM number_sequence WHERE company_id=$1 AND key='JOURNAL_ENTRY'", [W.companyA])).rows[0].next_value).toBe(number); }
 finally { await db.query('DROP TRIGGER fixture_balance_failure ON migration_batch; DROP FUNCTION fixture_balance_failure()'); }
});
it("posts the exact cutover delta once, preserves original entries and links immutable history", async () => {
 const p = await previewMigration(actor, target, financial);expect(p.ready).toBe(true);expect(p.totals).toMatchObject({ targetDebitCents: '10000', targetCreditCents: '10000', adjustmentDebitCents: '8900', adjustmentCreditCents: '8900' });
 const before = await count('journal_entry'), result = await confirmMigration(actor, target, financial, p.token, true);expect(result.journalEntryId).toBeTruthy();expect(await count('journal_entry')).toBe(before + 1);
 const balance = (await db.query('SELECT sum(debit_cents-credit_cents)::text AS cents FROM journal_line WHERE account_id=$1', [W.bank])).rows[0].cents;expect(balance).toBe('10000');
 expect((await migrationHistory(actor)).find(b => b.id === result.id)?.journalEntryId).toBe(result.journalEntryId);
 await expect(previewMigration(actor, target.replaceAll('100.00', '200.00'), financial)).rejects.toMatchObject({ key: 'migration.alreadyImported' });
});
