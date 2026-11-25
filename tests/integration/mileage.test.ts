import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { createMileageTrip,getMileageTrip,updateMileageTrip,deleteMileageTrip,getMileageLog,mileageFilters } from '@/modules/mileage';
import { owner } from './helpers';
import { W,seedWorld,appClient,inContext,asOwnerA,asOwnerB,asReader,sqlstate } from './world';
let db:pg.Client,app:pg.Client,id:string;
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader};
const input={date:'2026-06-15',vehicle:'Van %_A',origin:'Office',destination:'Client',purpose:'Visit',usage:'BUSINESS' as const,distanceMeters:12345};
const filters=mileageFilters({du:'2026-06-01',au:'2026-06-30'},'2026-11-25');
const insert=(values:unknown[]=[])=>app.query("INSERT INTO mileage_trip(id,company_id,trip_date,vehicle,origin,destination,purpose,usage,distance_meters,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,'Office','Client',$4,$5,$6,now())",values.length?values:[W.companyA,'2026-06-15','Direct','Visit','BUSINESS',1]);
beforeAll(async()=>{db=await owner();await seedWorld(db);app=await appClient();});afterAll(async()=>{await app?.end();await db?.end();});
it('creates, edits and deletes audited trips without financial mutations',async()=>{
 const counts=(await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM journal_line)::text AS lines')).rows;
 id=await createMileageTrip(actor,input);expect(await getMileageTrip(reader,id)).toMatchObject({...input,revision:1});await updateMileageTrip(actor,id,1,{...input,distanceMeters:12346});expect(await getMileageTrip(actor,id)).toMatchObject({distanceMeters:12346,revision:2});
 const personal=await createMileageTrip(actor,{...input,usage:'PERSONAL',purpose:'',distanceMeters:1});await expect(deleteMileageTrip(actor,personal,1,false)).rejects.toMatchObject({key:'mileage.confirm'});await deleteMileageTrip(actor,personal,1,true);await expect(getMileageTrip(actor,personal)).rejects.toMatchObject({key:'mileage.notFound'});
 expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='mileage_trip' AND entity_id=ANY($1::text[])",[[id,personal]])).rows[0].n).toBe(4);
 expect((await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM journal_line)::text AS lines')).rows).toEqual(counts);
});
it('serializes simultaneous revisions and refuses stale deletion without discarding a newer edit',async()=>{
 const r=await getMileageTrip(actor,id),results=await Promise.allSettled([updateMileageTrip(actor,id,r.revision,{...input,purpose:'A'}),updateMileageTrip(actor,id,r.revision,{...input,purpose:'B'})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'mileage.stale'}});await expect(deleteMileageTrip(actor,id,r.revision,true)).rejects.toMatchObject({key:'mileage.stale'});
});
it('keeps totals, classified metres and paginated detail in one filtered snapshot',async()=>{
 const before=await getMileageLog(actor,filters);
 await createMileageTrip(actor,{...input,date:'2026-06-30',usage:'PERSONAL',purpose:'',distanceMeters:1});await createMileageTrip(actor,{...input,date:'2026-05-31',distanceMeters:999});
 const r=await getMileageLog(actor,filters);expect(r.count).toBe(before.count+1);expect(r.businessMeters).toBe(before.businessMeters);expect(r.personalMeters).toBe(1n);expect(r.rows[0]?.date).toBe('2026-06-30');
 expect((await getMileageLog(actor,{...filters,vehicle:'%_'})).count).toBe(r.count);expect((await getMileageLog(actor,{...filters,vehicle:'%_x'})).count).toBe(0);expect((await getMileageLog(actor,{...filters,usage:'PERSONAL'})).count).toBe(1);
 const day=await getMileageLog(actor,{...filters,from:'2026-06-30',to:'2026-06-30'});expect(day.rows).toHaveLength(1);
});
it('requires Accounting for reads/writes and immediately applies overrides, clamps and revocation',async()=>{
 await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"sales\":\"none\",\"contacts\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 expect((await getMileageLog(reader,filters)).count).toBeGreaterThan(0);await expect(createMileageTrip(reader,input)).rejects.toMatchObject({key:'forbidden'});expect(await sqlstate(()=>inContext(app,asReader,()=>insert()))).toBe('42501');
 await db.query("UPDATE membership SET role='USER' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);const delegated=await createMileageTrip(reader,{...input,purpose:'Delegated'});await deleteMileageTrip(reader,delegated,1,true);
 await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(getMileageLog(reader,filters)).rejects.toMatchObject({key:'forbidden'});await expect(getMileageTrip(reader,id)).rejects.toMatchObject({key:'forbidden'});await expect(createMileageTrip(reader,input)).rejects.toMatchObject({key:'forbidden'});await expect(deleteMileageTrip(reader,id,3,true)).rejects.toMatchObject({key:'forbidden'});
 expect((await inContext(app,asReader,()=>app.query('SELECT id FROM mileage_trip'))).rowCount).toBe(0);await db.query("UPDATE membership SET role='READ_ONLY',module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
});
it('isolates company identities and enforces dates, text, distance and revisions in direct SQL',async()=>{
 const foreign={userId:W.userOwnerB,companyId:W.companyB};expect((await getMileageLog(foreign,filters)).count).toBe(0);await expect(getMileageTrip(foreign,id)).rejects.toMatchObject({key:'mileage.notFound'});await expect(updateMileageTrip(foreign,id,1,input)).rejects.toMatchObject({key:'mileage.notFound'});
 expect((await inContext(app,asOwnerB,()=>app.query('SELECT id FROM mileage_trip WHERE id=$1',[id]))).rowCount).toBe(0);expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert([W.companyB,'2026-06-01','Foreign','Visit','BUSINESS',1])))).toBe('42501');
 for(const values of [[W.companyA,'2026-06-01','Van','','BUSINESS',1],[W.companyA,'2026-06-01','Van','Visit','OTHER',1],[W.companyA,'2026-06-01','Van','Visit','BUSINESS',0],[W.companyA,'2026-06-01','Van','Visit','BUSINESS',10000001],[W.companyA,'2026-06-01','bad\u0085','Visit','BUSINESS',1],[W.companyA,'2026-06-01','\u00a0','Visit','BUSINESS',1]])expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(values)))).toBe('23514');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert([W.companyA,'2999-01-01','Future','Visit','BUSINESS',1])))).toBe('AL004');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('UPDATE mileage_trip SET purpose=$2 WHERE id=$1',[id,'No revision'])))).toBe('AL004');
 expect(await sqlstate(()=>inContext(db,asOwnerA,()=>db.query('UPDATE mileage_trip SET company_id=$2,revision=revision+1 WHERE id=$1',[id,W.companyB])))).toBe('AL004');
 await expect(createMileageTrip(actor,{...input,date:'2999-01-01'})).rejects.toMatchObject({key:'mileage.future'});await expect(createMileageTrip(actor,{...input,distanceMeters:1.5})).rejects.toMatchObject({key:'mileage.invalid'});
});
it('returns complete exports across pages and refuses more than 5,000 filtered trips',async()=>{
 await inContext(db,asOwnerA,()=>db.query("INSERT INTO mileage_trip(id,company_id,trip_date,vehicle,origin,destination,purpose,usage,distance_meters,updated_at) SELECT gen_random_uuid(),$1,'2026-07-01','Capacity','Office','Client','Visit','BUSINESS',10000000,now() FROM generate_series(1,5000)",[W.companyA]),{commit:true});
 const range={...filters,from:'2026-07-01',to:'2026-07-31'},page=await getMileageLog(actor,{...range,page:2});expect(page.rows).toHaveLength(50);expect(page.count).toBe(5000);expect(page.businessMeters).toBe(50000000000n);expect(page.pageCount).toBe(100);
 expect((await getMileageLog(actor,range,{allRows:true})).rows).toHaveLength(5000);expect((await getMileageLog(actor,{...range,page:999})).page).toBe(100);
 await inContext(app,asOwnerA,()=>insert([W.companyA,'2026-07-01','Capacity','Visit','PERSONAL',1]),{commit:true});await expect(getMileageLog(actor,range,{allRows:true})).rejects.toMatchObject({key:'mileage.exportLimit'});expect((await getMileageLog(actor,range)).count).toBe(5001);
 await expect(getMileageTrip(actor,randomUUID())).rejects.toMatchObject({key:'mileage.notFound'});
});
