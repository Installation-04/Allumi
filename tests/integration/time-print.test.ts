import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { createTimeEntry,getTimeLog,updateTimeEntry,timeFilters,TIME_PRINT_LIMIT } from "@/modules/time";
import { owner } from "./helpers";
import { W,seedWorld,appClient,inContext,asOwnerA } from "./world";
let db:pg.Client,app:pg.Client;
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader},other={userId:W.userOwnerB,companyId:W.companyB};
const input={date:'2026-09-15',project:'IMP111 %_',person:'Personne déclarée',task:'Activité',notes:'Note interne',usage:'BILLABLE' as const,minutes:1};
const f=timeFilters({du:'2026-09-01',au:'2026-09-30',projet:'IMP111 %_',page:'2'},'2026-11-27');
const counts=async()=>(await db.query('SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments')).rows;
beforeAll(async()=>{db=await owner();await seedWorld(db);app=await appClient();});afterAll(async()=>{await app?.end();await db?.end();});
it('reads all filtered pages and exact minute totals without mutating business data',async()=>{
 for(let i=0;i<106;i++)await createTimeEntry(actor,{...input,project:i===1?'IMP111 %_'+'X'.repeat(111):input.project,usage:i===0?'NON_BILLABLE':'BILLABLE',minutes:i===0?90:i===1?125:1});
 const before=await counts(),r=await getTimeLog(reader,f,{forPrint:true});expect(r.count).toBe(106);expect(r.rows).toHaveLength(106);expect(r.page).toBe(2);expect(r.billableMinutes).toBe(229n);expect(r.nonBillableMinutes).toBe(90n);expect(r.rows.some(x=>x.project.length===120)).toBe(true);expect(r.rows.every(x=>x.notes==='Note interne')).toBe(true);expect((await getTimeLog(reader,{...f,usage:'BILLABLE'},{forPrint:true})).count).toBe(105);expect((await getTimeLog(other,f,{forPrint:true})).rows).toEqual([]);expect(await counts()).toEqual(before);
});
it('accepts exactly 1,000 rows, refuses 1,001 rather than truncating and preserves the CSV limit',async()=>{
 await inContext(app,asOwnerA,()=>app.query("INSERT INTO time_entry(id,company_id,work_date,project,person,task,notes,usage,minutes,updated_at) SELECT gen_random_uuid(),$1::uuid,DATE '2026-09-15','CAP111','Person','Activity','','BILLABLE',1,now() FROM generate_series(1,1000)",[W.companyA]),{commit:true});
 const cap={...f,project:'CAP111'};expect(TIME_PRINT_LIMIT).toBe(1000);expect((await getTimeLog(reader,cap,{forPrint:true})).rows).toHaveLength(1000);await createTimeEntry(actor,{...input,project:'CAP111'});await expect(getTimeLog(reader,cap,{forPrint:true})).rejects.toMatchObject({key:'time.printLimit'});await expect(getTimeLog(reader,cap,{forPrint:true,allRows:true})).rejects.toMatchObject({key:'time.printLimit'});expect((await getTimeLog(reader,cap,{allRows:true})).rows).toHaveLength(1001);expect((await getTimeLog(reader,cap)).rows).toHaveLength(50);
});
it('requires Accounting read even after a previous authorized print and caps read-only overrides',async()=>{
 const a={...actor,userId:W.userAccountant};await db.query("UPDATE membership SET module_access='{\"accounting\":\"read\",\"sales\":\"none\",\"contacts\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,a.userId]);
 try{expect((await getTimeLog(a,f,{forPrint:true})).rows).toHaveLength(106);await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,a.userId]);await expect(getTimeLog(a,f,{forPrint:true})).rejects.toMatchObject({key:'forbidden'});}finally{await db.query("UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,a.userId]);}
 await expect(getTimeLog(reader,{...f,page:0},{forPrint:true})).rejects.toMatchObject({key:'time.filters'});
});
it('rereads on opening and keeps the previously returned snapshot independent of later edits',async()=>{
 const id=await createTimeEntry(actor,{...input,project:'CURRENT111',minutes:60}),current={...f,project:'CURRENT111'},first=await getTimeLog(reader,current,{forPrint:true});await updateTimeEntry(actor,id,1,{...input,project:'CURRENT111',minutes:120});const before=await counts(),next=await getTimeLog(reader,current,{forPrint:true});expect(first.billableMinutes).toBe(60n);expect(first.rows[0]?.minutes).toBe(60);expect(next.billableMinutes).toBe(120n);expect(next.rows[0]?.minutes).toBe(120);expect(await counts()).toEqual(before);
});
