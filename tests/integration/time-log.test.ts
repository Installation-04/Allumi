import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { createTimeEntry, getTimeEntry, updateTimeEntry, deleteTimeEntry, getTimeLog, timeFilters, type TimeInput } from "@/modules/time";
import { owner } from "./helpers";
import { W,seedWorld,appClient,inContext,asOwnerA,sqlstate } from "./world";
let db:pg.Client,app:pg.Client;
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader},other={userId:W.userOwnerB,companyId:W.companyB},writer={...actor,userId:W.userAccountant};
const input:TimeInput={date:'2026-06-01',project:'Dossier %_\\',person:'Camille',task:'Travail convenu',notes:'Note interne',usage:'BILLABLE',minutes:90};
const counts=async()=>(await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments')).rows;
beforeAll(async()=>{db=await owner();await seedWorld(db);app=await appClient();});afterAll(async()=>{await app?.end();await db?.end();});
it('creates/edits/deletes shared entries with audit and no financial mutations',async()=>{
 const before=await counts(),id=await createTimeEntry(actor,input);expect(await getTimeEntry(reader,id)).toMatchObject({...input,revision:1});await updateTimeEntry(actor,id,1,{...input,minutes:125});expect((await getTimeEntry(actor,id)).minutes).toBe(125);await expect(deleteTimeEntry(actor,id,2,false)).rejects.toMatchObject({key:'time.confirm'});await deleteTimeEntry(actor,id,2,true);await expect(getTimeEntry(actor,id)).rejects.toMatchObject({key:'time.notFound'});expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='time_entry' AND entity_id=$1",[id])).rows[0].n).toBe(3);expect(await counts()).toEqual(before);
});
it('isolates tenants and honors modular write/read/none and read-only caps',async()=>{
 const id=await createTimeEntry(actor,input);await expect(getTimeEntry(other,id)).rejects.toMatchObject({key:'time.notFound'});await expect(updateTimeEntry(other,id,1,input)).rejects.toMatchObject({key:'time.notFound'});await expect(createTimeEntry(reader,input)).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\",\"sales\":\"none\",\"contacts\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE user_id=$1 AND company_id=$2",[W.userAccountant,W.companyA]);await db.query("UPDATE membership SET module_access='{\"accounting\":\"write\"}' WHERE user_id=$1 AND company_id=$2",[W.userReader,W.companyA]);
 try{await updateTimeEntry(writer,id,1,{...input,usage:'NON_BILLABLE'});await expect(updateTimeEntry(reader,id,2,input)).rejects.toMatchObject({key:'forbidden'});await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE user_id=$1 AND company_id=$2",[W.userAccountant,W.companyA]);await expect(getTimeEntry(writer,id)).rejects.toMatchObject({key:'forbidden'});await expect(deleteTimeEntry(writer,id,2,true)).rejects.toMatchObject({key:'forbidden'});}finally{await db.query("UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id IN($2,$3)",[W.companyA,W.userAccountant,W.userReader]);}
});
it('serializes revisions so concurrent edits cannot overwrite an unseen decision',async()=>{
 const id=await createTimeEntry(actor,input),results=await Promise.allSettled([91,92].map(minutes=>updateTimeEntry(actor,id,1,{...input,minutes})));expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.find(x=>x.status==='rejected')).toMatchObject({reason:{key:'time.stale'}});await expect(deleteTimeEntry(actor,id,1,true)).rejects.toMatchObject({key:'time.stale'});expect((await getTimeEntry(actor,id)).revision).toBe(2);
});
it('summarizes the entire literal project filter and exports beyond the first page',async()=>{
 for(let i=0;i<52;i++)await createTimeEntry(actor,{...input,project:'LARGE %_',usage:i%2?'BILLABLE':'NON_BILLABLE',minutes:i+1});
 const f=timeFilters({du:'2026-06-01',au:'2026-06-30',projet:'LARGE %_'},'2026-06-30'),r=await getTimeLog(reader,f);expect(r.count).toBe(52);expect(r.rows).toHaveLength(50);expect(r.billableMinutes+r.nonBillableMinutes).toBe(1378n);expect((await getTimeLog(reader,{...f,page:2})).rows).toHaveLength(2);expect((await getTimeLog(reader,f,{allRows:true})).rows).toHaveLength(52);expect((await getTimeLog(reader,{...f,usage:'BILLABLE'})).count).toBe(26);expect((await getTimeLog(other,f)).count).toBe(0);
});
it('enforces SQL bounds, scope, date and revision independently of application validation',async()=>{
 const id=await createTimeEntry(actor,input);
 for(const data of [{...input,minutes:0},{...input,minutes:1441},{...input,date:'2999-01-01'},{...input,person:'x\n'},{...input,task:''}])await expect(createTimeEntry(actor,data)).rejects.toThrow();
 for(const assignment of ["minutes=0,revision=revision+1","minutes=1441,revision=revision+1","work_date='2999-01-01',revision=revision+1","revision=revision","company_id='00000000-0000-7000-8000-999999999999',revision=revision+1"]){const code=await sqlstate(()=>inContext(app,asOwnerA,()=>app.query(`UPDATE time_entry SET ${assignment} WHERE id=$1`,[id])));expect(code).not.toBeNull();}
 expect((await getTimeEntry(actor,id)).revision).toBe(1);
});
it('refuses a partial export above 5,000 entries while keeping exact filtered totals',async()=>{
 await inContext(app,asOwnerA,()=>app.query("INSERT INTO time_entry(id,company_id,work_date,project,person,task,notes,usage,minutes,updated_at) SELECT gen_random_uuid(),$1::uuid,DATE '2026-06-01','CAP109','Person','Activity','','BILLABLE',1,now() FROM generate_series(1,5001)",[W.companyA]),{commit:true});
 const f=timeFilters({du:'2026-06-01',au:'2026-06-30',projet:'CAP109'},'2026-06-30'),r=await getTimeLog(reader,f);expect(r.count).toBe(5001);expect(r.rows).toHaveLength(50);expect(r.billableMinutes).toBe(5001n);await expect(getTimeLog(reader,f,{allRows:true})).rejects.toMatchObject({key:'time.exportLimit'});
});
