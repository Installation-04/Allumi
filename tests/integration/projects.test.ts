import { beforeAll, afterAll, it, expect } from 'vitest';
import type pg from 'pg';
import { createProject, getProject, getProjectByCode, updateProject, setProjectArchived, listProjects, projectFilters, searchProjectCustomers } from '@/modules/projects';
import { createTimeEntry, getTimeEntry, updateTimeEntry, getTimeLog, timeFilters, timeQuery, timeCsv } from '@/modules/time';
import { owner } from './helpers';
import { W, seedWorld, appClient, inContext, asOwnerA, sqlstate } from './world';
let db: pg.Client, app: pg.Client;
const a = { userId: W.userOwnerA, companyId: W.companyA }, b = { userId: W.userOwnerB, companyId: W.companyB }, reader = { ...a, userId: W.userReader }, accountant = { ...a, userId: W.userAccountant };
const foreignCustomer = '00000000-0000-7000-8000-00000000c0b1';
const input = { code: 'P112', name: 'Projet de référence', description: 'Dossier fictif', customerId: W.customer };
const time = { date: '2026-09-15', project: 'Ancien libellé', person: 'Camille', task: 'Service', notes: 'Note interne', usage: 'BILLABLE' as const, minutes: 90 };
const financial = async () => (await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments')).rows;
beforeAll(async () => { db = await owner(); await seedWorld(db); await db.query("INSERT INTO contact(id,company_id,is_customer,display_name,updated_at) VALUES($1,$2,true,'Client autre entreprise',now())", [foreignCustomer, W.companyB]); app = await appClient(); });
afterAll(async () => { await app?.end(); await db?.end(); });
it('creates unique stable codes, customer references and audited revisions without financial writes', async () => {
    const before = await financial(), id = await createProject(a, { ...input, code: ' p112 ' });
    expect(await getProject(reader, id)).toMatchObject({ ...input, id, revision: 1, status: 'ACTIVE', hasCustomer: true });
    expect((await getProjectByCode(a, 'p112')).id).toBe(id);
    await expect(createProject(a, input)).rejects.toMatchObject({ key: 'project.codeExists' });
    await expect(createProject(a, { ...input, code: 'FOREIGN', customerId: foreignCustomer })).rejects.toMatchObject({ key: 'project.customerUnavailable' });
    await expect(createProject(a, { ...input, code: 'SUPPLIER', customerId: W.supplier })).rejects.toMatchObject({ key: 'project.customerUnavailable' });
    await expect(updateProject(a, id, 1, { ...input, code: 'NEW' })).rejects.toMatchObject({ key: 'project.codeImmutable' });
    await db.query('UPDATE contact SET is_active=false WHERE id=$1', [W.customer]);
    try {
        await expect(createProject(a, { ...input, code: 'INACTIVE112' })).rejects.toMatchObject({ key: 'project.customerUnavailable' });
        await updateProject(a, id, 1, { ...input, name: 'Nom courant' });
    }
    finally {
        await db.query('UPDATE contact SET is_active=true WHERE id=$1', [W.customer]);
    }
    expect((await getProject(a, id)).revision).toBe(2);
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='project' AND entity_id=$1", [id])).rows[0].n).toBe(2);
    expect(await financial()).toEqual(before);
    await expect(getProject(b, id)).rejects.toMatchObject({ key: 'project.notFound' });
    await expect(updateProject(b, id, 2, input)).rejects.toMatchObject({ key: 'project.notFound' });
    expect(await createProject(b, { ...input, customerId: foreignCustomer })).toBeTruthy();
});
it('serializes simultaneous edits and prevents stale archival', async () => {
    const id = await createProject(a, { ...input, code: 'RACE112' });
    const results = await Promise.allSettled(['Premier', 'Second'].map(name => updateProject(a, id, 1, { ...input, code: 'RACE112', name })));
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(x => x.status === 'rejected')).toMatchObject({ reason: { key: 'project.stale' } });
    await expect(setProjectArchived(a, id, 1, true, true)).rejects.toMatchObject({ key: 'project.stale' });
    await expect(setProjectArchived(a, id, 2, true, false)).rejects.toMatchObject({ key: 'project.confirm' });
});
it('links time explicitly, preserves snapshots through renames and archives, and filters/export by stable code', async () => {
    const before = await financial(), legacy = await createTimeEntry(a, { ...time, project: 'Projet de référence' }), id = await createProject(a, { ...input, code: 'TIME112' }), linked = await createTimeEntry(a, { ...time, project: '', projectId: id });
    expect(await getTimeEntry(a, legacy)).toMatchObject({ projectId: null, project: 'Projet de référence' });
    expect(await getTimeEntry(a, linked)).toMatchObject({ projectId: id, projectCode: 'TIME112', project: input.name });
    await updateProject(a, id, 1, { ...input, code: 'TIME112', name: 'Nouveau nom' });
    expect((await getTimeEntry(a, linked)).project).toBe(input.name);
    await updateTimeEntry(a, linked, 1, { ...time, project: 'Nom falsifié', projectId: id, minutes: 125 });
    expect((await getTimeEntry(a, linked)).project).toBe(input.name);
    const next = await createTimeEntry(a, { ...time, projectId: id });
    expect((await getTimeEntry(a, next)).project).toBe('Nouveau nom');
    await setProjectArchived(a, id, 2, true, true);
    await expect(createTimeEntry(a, { ...time, projectId: id })).rejects.toMatchObject({ key: 'project.archived' });
    await expect(updateProject(a, id, 3, { ...input, code: 'TIME112' })).rejects.toMatchObject({ key: 'project.archived' });
    await updateTimeEntry(a, linked, 2, { ...time, projectId: id });
    const f = timeFilters({ du: '2026-09-01', au: '2026-09-30', dossier: 'time112' }, '2026-11-28'), r = await getTimeLog(reader, f, { forPrint: true });
    expect(r.count).toBe(2);
    expect(r.billableMinutes).toBe(180n);
    expect(r.rows.every(x => x.projectCode === 'TIME112')).toBe(true);
    expect(timeQuery(f)).toContain('dossier=TIME112');
    expect(timeCsv(r, 'en', k => k)).toContain('TIME112 — Nouveau nom');
    expect((await getTimeLog(b, f)).count).toBe(0);
    await expect(updateTimeEntry(a, linked, 3, { ...time, projectId: null })).rejects.toMatchObject({ key: 'project.detachConfirm' });
    await updateTimeEntry(a, linked, 3, { ...time, projectId: null }, true);
    expect(await getTimeEntry(a, linked)).toMatchObject({ projectId: null, project: time.project });
    await setProjectArchived(a, id, 3, false, true);
    expect((await getProject(a, id)).status).toBe('ACTIVE');
    expect(await financial()).toEqual(before);
});
it('does not disclose client fields without Contacts and independently enforces modular writes/read-only caps', async () => {
    const id = await createProject(a, { ...input, code: 'ACCESS112' });
    await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    try {
        const p = await getProject(accountant, id);
        expect(p.hasCustomer).toBe(true);
        expect(p).not.toHaveProperty('customerId');
        expect(p).not.toHaveProperty('customerName');
        await expect(searchProjectCustomers(accountant, 'Client')).rejects.toMatchObject({ key: 'forbidden' });
        await updateProject(accountant, id, 1, { code: 'ACCESS112', name: 'Modification sans données client', description: '' });
        await expect(updateProject(accountant, id, 2, { ...input, code: 'ACCESS112', customerId: null })).rejects.toMatchObject({ key: 'forbidden' });
        expect(await sqlstate(() => inContext(app, { userId: W.userAccountant, companyId: W.companyA }, () => app.query('UPDATE project SET customer_id=NULL,revision=revision+1 WHERE id=$1', [id])))).toBe('AL004');
        const hiddenCreate = await createProject(accountant, { code: 'NOCLIENT112', name: 'Projet sans client', description: '' });
        expect((await getProject(accountant, hiddenCreate)).hasCustomer).toBe(false);
        await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"contacts\":\"read\",\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
        const readClient = await createProject(accountant, { ...input, code: 'CONTACTREAD112' });
        expect((await getProject(accountant, readClient)).customerId).toBe(W.customer);
        await updateProject(accountant, id, 2, { ...input, code: 'ACCESS112', customerId: W.otherCustomer });
        expect((await getProject(accountant, id)).customerId).toBe(W.otherCustomer);

        await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
        await expect(getProject(accountant, id)).rejects.toMatchObject({ key: 'forbidden' });
    }
    finally {
        await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    }
    await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader]);
    try {
        await expect(createProject(reader, { ...input, code: 'READONLY112' })).rejects.toMatchObject({ key: 'forbidden' });
    }
    finally {
        await db.query("UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader]);
    }
});
it('searches names literally and returns a bounded stable page from one snapshot', async () => {
    for (let i = 0; i < 52; i++)
        await createProject(a, { code: `LIST112-${String(i).padStart(2, '0')}`, name: 'Recherche %_ ' + i, description: '' });
    const f = projectFilters({ q: '%_', statut: 'ALL', page: '2' }), r = await listProjects(reader, f);
    expect(r.count).toBe(52);
    expect(r.rows).toHaveLength(2);
    expect(r.pages).toBe(2);
    expect((await listProjects(reader, { ...f, q: '%', page: 999 })).page).toBe(2);
    expect((await listProjects(b, f)).count).toBe(0);
    const clients = await searchProjectCustomers(a, 'Client');
    expect(clients.rows.some(x => x.id === W.customer)).toBe(true);
    expect(clients.rows.every(x => Object.keys(x).sort().join(',') === 'displayName,id')).toBe(true);
    await db.query("INSERT INTO contact(id,company_id,is_customer,display_name,updated_at) SELECT gen_random_uuid(),$1,true,'LOOK112 '||n::text,now() FROM generate_series(1,21) n", [W.companyA]);
    const capped = await searchProjectCustomers(a, 'LOOK112');
    expect(capped.rows).toHaveLength(20);
    expect(capped.hasMore).toBe(true);
});
it('enforces codes, revisions, customer scope and immutable snapshots in SQL, without delete privilege', async () => {
    const id = await createProject(a, { ...input, code: 'SQL112' }), entry = await createTimeEntry(a, { ...time, projectId: id });
    for (const assignment of ["code='OTHER',revision=revision+1", "name='',revision=revision+1", "description=E'newline\\n',revision=revision+1", "customer_id='00000000-0000-7000-8000-00000000c0b1',revision=revision+1", "revision=revision", "status='OTHER',revision=revision+1", "created_at=created_at+interval '1 second',revision=revision+1"]) {
        expect(await sqlstate(() => inContext(app, asOwnerA, () => app.query(`UPDATE project SET ${assignment} WHERE id=$1`, [id])))).not.toBeNull();
    }
    expect(await sqlstate(() => inContext(app, asOwnerA, () => app.query('DELETE FROM project WHERE id=$1', [id])))).toBe('42501');
    expect(await sqlstate(() => inContext(app, asOwnerA, () => app.query("UPDATE time_entry SET project='Forged',revision=revision+1 WHERE id=$1", [entry])))).toBe('AL004');
    const raw = await createTimeEntry(a, time);
    await inContext(app, asOwnerA, () => app.query("UPDATE time_entry SET project_id=$2,project='Forged',revision=revision+1 WHERE id=$1", [raw, id]), { commit: true });
    expect((await getTimeEntry(a, raw)).project).toBe(input.name);
    const other = await createProject(b, { code: 'FOREIGN112', name: 'Autre entreprise', description: '' });
    expect(await sqlstate(() => inContext(app, asOwnerA, () => app.query('UPDATE time_entry SET project_id=$2,revision=revision+1 WHERE id=$1', [entry, other])))).not.toBeNull();
    await setProjectArchived(a, id, 1, true, true);
    expect(await sqlstate(() => inContext(app, asOwnerA, () => app.query("UPDATE project SET name='Changed',revision=revision+1 WHERE id=$1", [id])))).toBe('AL004');
});
it('waits for a concurrent archive and refuses attaching time after its commit', async () => {
    const id = await createProject(a, { code: 'ARCHRACE112', name: 'Concurrence', description: '' });
    let attempt: Promise<unknown> | undefined;
    await db.query('BEGIN');
    try {
        await db.query('SELECT id FROM project WHERE id=$1 FOR UPDATE', [id]);
        attempt = createTimeEntry(a, { ...time, projectId: id }).then(() => null, e => e);
        let blocked = false;
        for (let n = 0; n < 200; n++) {
            await db.query('SELECT pg_stat_clear_snapshot()');
            const r = await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%time_entry%') AS blocked");
            if (r.rows[0].blocked) {
                blocked = true;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await db.query("UPDATE project SET status='ARCHIVED',revision=revision+1 WHERE id=$1", [id]);
        await db.query('COMMIT');
        expect(await attempt).toBeInstanceOf(Error);
        expect((await db.query('SELECT count(*)::int AS n FROM time_entry WHERE project_id=$1', [id])).rows[0].n).toBe(0);
    }
    finally {
        await db.query('ROLLBACK');
        await attempt;
    }
});

it('limits the client-lock capability to authorized writers in the effective company', async () => {
    const ctx = { userId: W.userAccountant, companyId: W.companyA };
    await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"contacts\":\"read\",\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    const invoke = (company: string | null, id: string | null) => app.query('SELECT project_lock_customer($1::uuid,$2::uuid) AS ok', [company, id]);
    try {
        const audit = (await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='contact'")).rows[0].n;
        expect((await inContext(app, ctx, () => invoke(W.companyA, W.customer))).rows[0].ok).toBe(true);
        expect((await inContext(app, ctx, () => invoke(W.companyA, foreignCustomer))).rows[0].ok).toBe(false);
        for (const [company, id] of [[W.companyB, foreignCustomer], [null, W.customer], [W.companyA, null]]) {
            expect(await sqlstate(() => inContext(app, ctx, () => invoke(company!, id!)))).toBe('42501');
        }
        expect(await sqlstate(() => inContext(app, {}, () => invoke(W.companyA, W.customer)))).toBe('42501');
        expect(await sqlstate(() => inContext(app, { userId: W.userReader, companyId: W.companyA }, () => invoke(W.companyA, W.customer)))).toBe('42501');
        await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"contacts\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
        expect(await sqlstate(() => inContext(app, ctx, () => invoke(W.companyA, W.customer)))).toBe('42501');
        await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\",\"contacts\":\"read\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
        expect(await sqlstate(() => inContext(app, ctx, () => invoke(W.companyA, W.customer)))).toBe('42501');
        expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='contact'")).rows[0].n).toBe(audit);
    } finally {
        await db.query("UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    }
});

it('rereads client availability after waiting for a concurrent directory change', async () => {
    let attempt: Promise<unknown> | undefined, committed = false;
    await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"contacts\":\"read\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    await db.query('BEGIN');
    try {
        await db.query('SELECT id FROM contact WHERE id=$1 FOR UPDATE', [W.customer]);
        attempt = createProject(accountant, { ...input, code: 'CLIENTRACE112' }).then(() => null, e => e);
        let blocked = false;
        for (let n = 0; n < 200; n++) {
            await db.query('SELECT pg_stat_clear_snapshot()');
            const r = await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%project_lock_customer%') AS blocked");
            if (r.rows[0].blocked) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await db.query('UPDATE contact SET is_active=false WHERE id=$1', [W.customer]);
        await db.query('COMMIT'); committed = true;
        expect(await attempt).toMatchObject({ key: 'project.customerUnavailable' });
        expect((await db.query("SELECT count(*)::int AS n FROM project WHERE code='CLIENTRACE112'")).rows[0].n).toBe(0);
    } finally {
        if (!committed) await db.query('ROLLBACK');
        await attempt;
        await db.query('UPDATE contact SET is_active=true WHERE id=$1', [W.customer]);
        await db.query("UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    }
});
