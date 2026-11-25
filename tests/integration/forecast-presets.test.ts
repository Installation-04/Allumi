import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createForecastPreset, deleteForecastPreset, listForecastPresets } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld, W, appClient, inContext, asOwnerA, asOwnerB, asReader, setContext, sqlstate } from "./world";

let db:pg.Client, app:pg.Client, other:pg.Client, id:string;
const actor={userId:W.userOwnerA,companyId:W.companyA}, reader={...actor,userId:W.userReader};
const input={name:"Delayed receipts",days:30,receiptDelay:14,paymentDelay:7};
const insert=(client:pg.Client,companyId:string,name:string,days=30,receipt=14,payment=7)=>client.query("INSERT INTO cash_forecast_preset(id,company_id,name,days,receipt_delay,payment_delay) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)",[companyId,name,days,receipt,payment]);
beforeAll(async()=>{db=await owner();await seedWorld(db);app=await appClient();other=await appClient();});
afterAll(async()=>{await other?.end();await app?.end();await db?.end();});

it("shares reusable assumptions with readers and audits creation/deletion without financial mutations",async()=>{
  const before=(await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM journal_line)::text AS lines')).rows;
  id=await createForecastPreset(actor,input);
  expect(await listForecastPresets(reader)).toEqual([{id,...input}]);
  const disposable=await createForecastPreset(actor,{...input,name:'Temporary'});
  await expect(deleteForecastPreset(actor,disposable,false)).rejects.toMatchObject({key:'reports.presetConfirm'});
  await deleteForecastPreset(actor,disposable,true);
  const audits=(await db.query('SELECT action,actor_user_id FROM audit_log WHERE entity_type=$1 AND entity_id=$2 ORDER BY occurred_at,id',['cash_forecast_preset',disposable])).rows;
  expect(audits).toHaveLength(2);expect(audits.every(a=>a.actor_user_id===W.userOwnerA)).toBe(true);
  expect((await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM journal_line)::text AS lines')).rows).toEqual(before);
});
it("rejects invalid/duplicate presets, requires confirmation and does not reveal foreign configurations",async()=>{
  await expect(createForecastPreset(actor,input)).rejects.toMatchObject({key:'reports.presetDuplicate'});
  for(const patch of [{name:''},{name:'bad\nname'},{days:14},{receiptDelay:1},{paymentDelay:-1}])await expect(createForecastPreset(actor,{...input,...patch})).rejects.toMatchObject({key:'reports.presetInvalid'});
  const foreign={userId:W.userOwnerB,companyId:W.companyB};expect(await listForecastPresets(foreign)).toEqual([]);
  await expect(deleteForecastPreset(foreign,id,true)).rejects.toMatchObject({key:'reports.presetNotFound'});
  await expect(deleteForecastPreset(actor,'bad-id',true)).rejects.toMatchObject({key:'reports.presetNotFound'});
  expect((await inContext(app,asOwnerB,()=>app.query('SELECT id FROM cash_forecast_preset WHERE id=$1',[id]))).rowCount).toBe(0);
  expect(await sqlstate(()=>inContext(app,asOwnerB,()=>app.query('DELETE FROM cash_forecast_preset WHERE id=$1',[id])))).toBe(null);
  expect((await listForecastPresets(actor))[0]?.id).toBe(id);
});
it("clamps read-only roles and rechecks Accounting/Sales overrides and revocation for each operation",async()=>{
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"sales\":\"read\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
  await expect(createForecastPreset(reader,{...input,name:'Denied'})).rejects.toMatchObject({key:'forbidden'});
  await expect(deleteForecastPreset(reader,id,true)).rejects.toMatchObject({key:'forbidden'});
  expect(await sqlstate(()=>inContext(app,asReader,()=>insert(app,W.companyA,'Denied SQL')))).toBe('42501');
  await db.query("UPDATE membership SET role='USER' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
  const delegated=await createForecastPreset(reader,{...input,name:'Delegated'});await deleteForecastPreset(reader,delegated,true);
  for(const access of [{accounting:'none',sales:'read'},{accounting:'write',sales:'none'}]){
    await db.query('UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2',[W.companyA,W.userReader,JSON.stringify(access)]);
    await expect(listForecastPresets(reader)).rejects.toMatchObject({key:'forbidden'});
    await expect(createForecastPreset(reader,{...input,name:'Revoked'})).rejects.toMatchObject({key:'forbidden'});
    await expect(deleteForecastPreset(reader,id,true)).rejects.toMatchObject({key:'forbidden'});
    expect((await inContext(app,asReader,()=>app.query('SELECT id FROM cash_forecast_preset'))).rowCount).toBe(0);
    expect(await sqlstate(()=>inContext(app,asReader,()=>insert(app,W.companyA,'Revoked SQL')))).toBe('42501');
  }
  await db.query("UPDATE membership SET role='READ_ONLY',module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
});
it("enforces SQL constraints and immutable settings independently of the service",async()=>{
  for(const args of [['Empty',14,0,0],['Bad delay',30,1,0],['Bad payment',30,0,1],['',30,0,0],['bad\nname',30,0,0],['X'.repeat(81),30,0,0]] as const)expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(app,W.companyA,args[0],args[1],args[2],args[3])))).toBe('23514');
  expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('UPDATE cash_forecast_preset SET days=7 WHERE id=$1',[id])))).toBe('42501');
  expect(await sqlstate(()=>inContext(db,asOwnerA,()=>db.query('UPDATE cash_forecast_preset SET days=7 WHERE id=$1',[id])))).toBe('AL004');
  expect(await sqlstate(async()=>{await app.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await setContext(app,asOwnerA);await insert(app,W.companyA,'Stale snapshot');}finally{await app.query('ROLLBACK');}})).toBe('AL004');
  expect(await sqlstate(()=>inContext(app,asOwnerA,()=>insert(app,W.companyB,'Foreign insert')))).toBe('42501');
});
it("serializes concurrent service creates and direct SQL inserts at the twenty-item boundary",async()=>{
  const b={userId:W.userOwnerB,companyId:W.companyB};
  for(let i=0;i<19;i++)await createForecastPreset(b,{...input,name:`Capacity ${i}`});
  const results=await Promise.allSettled([createForecastPreset(b,{...input,name:'Last A'}),createForecastPreset(b,{...input,name:'Last B'})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'reports.presetLimit'}});
  expect(await listForecastPresets(b)).toHaveLength(20);
  const last=results.find(r=>r.status==='fulfilled');if(last?.status!=='fulfilled')throw Error('missing winner');await deleteForecastPreset(b,last.value,true);
  const sql=await Promise.all([sqlstate(()=>inContext(app,asOwnerB,()=>insert(app,W.companyB,'SQL last A'),{commit:true})),sqlstate(()=>inContext(other,asOwnerB,()=>insert(other,W.companyB,'SQL last B'),{commit:true}))]);
  expect(sql.sort()).toEqual(['AL004',null].sort());expect(await listForecastPresets(b)).toHaveLength(20);
  expect(await sqlstate(()=>inContext(app,asOwnerB,()=>insert(app,W.companyB,'Over capacity')))).toBe('AL004');
  const before=(await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='cash_forecast_preset'")).rows;
  expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query("INSERT INTO cash_forecast_preset(id,company_id,name,days,receipt_delay,payment_delay) SELECT gen_random_uuid(),$1,'Bulk '||n,30,0,0 FROM generate_series(1,20) n",[W.companyA]),{commit:true}))).toBe('AL004');
  expect(await listForecastPresets(actor)).toHaveLength(1);expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='cash_forecast_preset'")).rows).toEqual(before);
});
