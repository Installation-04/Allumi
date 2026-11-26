import { beforeAll, afterAll, it, expect } from 'vitest';
import type pg from 'pg';
import { searchContractCustomers } from '@/modules/contracts';
import { saveContact, setContactActive } from '@/modules/contacts';
import { owner } from './helpers';
import { W, seedWorld } from './world';
let db: pg.Client;
const actor={userId:W.userOwnerA,companyId:W.companyA},other={userId:W.userOwnerB,companyId:W.companyB},reader={...actor,userId:W.userReader},accountant={...actor,userId:W.userAccountant};
const input={kind:'CUSTOMER',displayName:'Choix101 %_\\ client',email:'choice101@example.test',notes:'PRIVATE-NOTES-101',addressLine1:'PRIVATE-ADDRESS-101',phone:'PRIVATE-PHONE-101'};
beforeAll(async()=>{db=await owner();await seedWorld(db);});afterAll(async()=>{await db?.end();});
it('finds active customers/both only with literal search, minimum fields, tenant isolation and no mutations',async()=>{
 const a=await saveContact(actor,input),b=await saveContact(actor,{...input,kind:'BOTH'});await saveContact(actor,{...input,kind:'SUPPLIER'});const archived=await saveContact(actor,input);await setContactActive(actor,archived.id,false);await saveContact(other,input);
 const before=(await db.query('SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM client_document)::text AS documents')).rows;
 const found=await searchContractCustomers(actor,'%_\\');expect(found.hasMore).toBe(false);expect(found.rows.map(r=>r.id)).toEqual([a.id,b.id].sort());expect(found.rows.every(r=>Object.keys(r).sort().join(',')==='displayName,email,id')).toBe(true);expect(JSON.stringify(found)).not.toContain('PRIVATE-');expect((await searchContractCustomers(other,'%_\\')).rows).toHaveLength(1);
 expect((await searchContractCustomers(actor,'CHOICE101@EXAMPLE.TEST')).rows.map(r=>r.id)).toEqual([a.id,b.id].sort());expect((await db.query('SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM client_document)::text AS documents')).rows).toEqual(before);
});
it('caps results at 20 and signals remaining matches with deterministic ordering',async()=>{
 for(let i=0;i<21;i++)await saveContact(actor,{kind:'CUSTOMER',displayName:'Boundary101 '+String(i).padStart(2,'0')});const a=await searchContractCustomers(actor,'Boundary101'),b=await searchContractCustomers(actor,'Boundary101');expect(a).toEqual(b);expect(a.rows).toHaveLength(20);expect(a.hasMore).toBe(true);expect(a.rows[0]?.displayName).toBe('Boundary101 00');expect(a.rows[19]?.displayName).toBe('Boundary101 19');expect((await searchContractCustomers(actor,'Boundary101 20')).hasMore).toBe(false);
});
it('requires both sales write and contact read, respects the read-only cap and works without accounting/taxes',async()=>{
 await db.query("UPDATE membership SET module_access='{\"sales\":\"write\",\"contacts\":\"read\",\"accounting\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(searchContractCustomers(reader,'Choix101')).rejects.toMatchObject({key:'forbidden'});
 for(const access of [{sales:'none',contacts:'read'},{sales:'read',contacts:'read'},{sales:'write',contacts:'none'}]){await db.query('UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2',[W.companyA,W.userAccountant,JSON.stringify(access)]);await expect(searchContractCustomers(accountant,'Choix101')).rejects.toMatchObject({key:'forbidden'});}
 await db.query("UPDATE membership SET module_access='{\"sales\":\"write\",\"contacts\":\"read\",\"accounting\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant]);expect((await searchContractCustomers(accountant,'Choix101')).rows).toHaveLength(2);
});
it('rejects malformed searches and excludes anonymized identities',async()=>{
 for(const q of ['', 'x', ['aa','bb'],'Alice\n','x'.repeat(101)])await expect(searchContractCustomers(actor,q)).rejects.toThrow(RangeError);
 const c=await saveContact(actor,{kind:'CUSTOMER',displayName:'Anonymized101'});await db.query("UPDATE contact SET display_name='Contact anonymisé',email=NULL,phone=NULL,notes=NULL,is_active=false,anonymized_at=now() WHERE id=$1",[c.id]);expect((await searchContractCustomers(actor,'Anonymized101')).rows).toHaveLength(0);expect((await searchContractCustomers(actor,'Contact anonymisé')).rows).toHaveLength(0);
});
