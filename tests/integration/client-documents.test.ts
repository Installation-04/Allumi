import { randomUUID } from 'node:crypto';
import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import type pg from 'pg';
const mail=vi.hoisted(()=>vi.fn(async()=> 'ACCEPTED' as const));
vi.mock('@/platform/mail',()=>({mailConfigured:()=>true,requireMailConfigured:()=>{},deliverMail:mail}));
import { saveContractTemplate,getContractTemplate,saveContract,getClientDocument,listClientDocuments,publishClientDocument,revokeClientDocument,prepareSourceDocument,sendClientDocument,peekClientDocument,openClientDocument,signClientDocument } from '@/modules/contracts';
import { saveEstimate,getEstimate,transitionEstimate,saveDraft,getDraft,postInvoice,getInvoice } from '@/modules/sales';
import { owner } from './helpers';
import { W,seedWorld,appClient,inContext,asOwnerA,asReader,sqlstate } from './world';
let db:pg.Client,app:pg.Client,id:string,url:string,token:string;
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader},other={userId:W.userOwnerB,companyId:W.companyB};
const body='{{company_name}}\n{{client_name}}\n'+('Conditions générales '.repeat(400))+'\n{{hourly_rate}} à chaque heure. Rappel : {{hourly_rate}}.';
const input={title:'Contrat de service',customerName:'Client Exemple',customerEmail:'client@example.test',locale:'fr-CA' as const,hourlyRate:'125,99',body};
const tokenOf=(value:string)=>new URL(value).pathname.split('/').at(-1)!;
const sign=(hash:string,name='Alex Client')=>({name,email:input.customerEmail,consent:true,hash});
beforeAll(async()=>{db=await owner();await seedWorld(db);app=await appClient();await db.query("UPDATE account SET system_key='ACCOUNTS_RECEIVABLE' WHERE id=$1",[W.receivable]);await db.query("INSERT INTO number_sequence(company_id,key,prefix,padding,next_value) VALUES($1,'INVOICE','FAC-',5,1),($1,'JOURNAL_ENTRY','J-',5,1)",[W.companyA]);});
afterAll(async()=>{await app?.end();await db?.end();});
it('stores long templates and draft revisions while isolating links and avoiding financial mutations',async()=>{
 const before=(await db.query('SELECT count(*) AS n FROM journal_entry')).rows;
 await saveContractTemplate(actor,body,'125.99',0);expect((await getContractTemplate(reader))?.body).toBe(body);await expect(saveContractTemplate(actor,body,'1',0)).rejects.toMatchObject({key:'contracts.stale'});
 id=await saveContract(actor,input);const d=(await getClientDocument(actor,id))!;expect(d.status).toBe('DRAFT');expect(d.url).toBeNull();expect(d.hourlyRateCents).toBe(12599n);expect(await getClientDocument(other,id)).toBeNull();expect((await listClientDocuments(other)).rows).toHaveLength(0);
 const results=await Promise.allSettled([saveContract(actor,{...input,hourlyRate:'99'},id,1),saveContract(actor,{...input,hourlyRate:'101'},id,1)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{key:'contracts.stale'}});
 await expect(publishClientDocument(actor,id,2,false)).rejects.toMatchObject({key:'contracts.confirm'});url=await publishClientDocument(actor,id,2,true);token=tokenOf(url);expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect((await getClientDocument(actor,id))?.url).toBe(url);expect((await getClientDocument(reader,id))?.url).toBeNull();expect((await db.query('SELECT count(*) AS n FROM journal_entry')).rows).toEqual(before);
});
it('records a view only on explicit opening and signs the immutable reviewed content once under concurrency',async()=>{
 const peek=await peekClientDocument(token,'192.0.2.10');expect(peek?.title).toBe(input.title);expect(peek).not.toHaveProperty('body');expect((await getClientDocument(actor,id))?.firstViewedAt).toBeNull();
 const d=(await getClientDocument(actor,id))!;await expect(signClientDocument(token,sign(d.contentHash!),'192.0.2.11')).rejects.toMatchObject({key:'contracts.signature'});
 const opened=(await openClientDocument(token,'192.0.2.12'))!;expect(opened.body).toContain('Conditions générales '.repeat(400));expect(opened.body.match(/(?:99|101),00 CAD\/h/g)).toHaveLength(2);expect(opened.body).not.toContain('{{');
 const viewed=(await getClientDocument(actor,id))!;await openClientDocument(token,'192.0.2.12');expect((await getClientDocument(actor,id))?.revision).toBe(viewed.revision);
 for(const patch of [{consent:false},{email:'someone@example.test'},{hash:'0'.repeat(64)},{name:'Bad\nName'}])await expect(signClientDocument(token,{...sign(opened.hash),...patch},'192.0.2.13')).rejects.toMatchObject({key:'contracts.signature'});
 const results=await Promise.allSettled([signClientDocument(token,sign(opened.hash,'Alex Client'),'192.0.2.14'),signClientDocument(token,sign(opened.hash,'Autre Client'),'192.0.2.15')]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const signed=(await openClientDocument(token,'192.0.2.12'))!;expect(signed.signedAt).not.toBeNull();expect(signed.hash).toBe(opened.hash);expect(signed.consentText).toContain('signer électroniquement');
 const revision=(await getClientDocument(actor,id))!.revision;await signClientDocument(token,sign(opened.hash,signed.signerName!),'192.0.2.16');expect((await getClientDocument(actor,id))!.revision).toBe(revision);
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('UPDATE client_document SET signed_at=now() WHERE id=$1',[id])))).toBe('42501');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query("UPDATE client_document SET body='Modified',revision=revision+1 WHERE id=$1",[id])))).toBe('AL004');
 expect(await sqlstate(()=>inContext(app,asOwnerA,()=>app.query('DELETE FROM client_document WHERE id=$1',[id])))).toBe('AL004');
 expect((await inContext(app,{},()=>app.query('SELECT id FROM client_document'))).rowCount).toBe(0);
 const stored=(await db.query('SELECT token_hash,encode(token_cipher,\'hex\') AS cipher FROM client_document WHERE id=$1',[id])).rows[0];const audit=JSON.stringify((await db.query("SELECT to_jsonb(a) AS row FROM audit_log a WHERE entity_type='client_document' AND entity_id=$1",[id])).rows);expect(audit).not.toContain(token);expect(audit).not.toContain(stored.token_hash);expect(audit).not.toContain(stored.cipher);
});
it('retains signature evidence when revoking access and refuses expired links',async()=>{
 const d=(await getClientDocument(actor,id))!;await revokeClientDocument(actor,id,d.revision,true);expect(await peekClientDocument(token,'192.0.2.20')).toBeNull();expect(await openClientDocument(token,'192.0.2.20')).toBeNull();expect((await getClientDocument(actor,id))?.signedAt).toEqual(d.signedAt);
 const expired=await saveContract(actor,input);const u=await publishClientDocument(actor,expired,1,true);await db.query("UPDATE client_document SET expires_at=published_at+interval '1 microsecond',revision=revision+1 WHERE id=$1",[expired]);expect(await peekClientDocument(tokenOf(u),'192.0.2.21')).toBeNull();
});
it('clamps read-only overrides, supports Sales without other modules and applies permission revocation',async()=>{
 await db.query("UPDATE membership SET role='USER',module_access='{\"sales\":\"write\",\"accounting\":\"none\",\"contacts\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 const delegated=await saveContract(reader,input);await db.query("UPDATE membership SET role='READ_ONLY' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);expect((await getClientDocument(reader,delegated))?.writable).toBe(false);await expect(saveContract(reader,input)).rejects.toMatchObject({key:'forbidden'});expect((await inContext(app,asReader,()=>app.query("UPDATE client_document SET title='No',revision=revision+1 WHERE id=$1",[delegated]))).rowCount).toBe(0);expect((await getClientDocument(reader,delegated))?.title).toBe(input.title);
 await db.query("UPDATE membership SET module_access='{\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(getClientDocument(reader,delegated)).rejects.toMatchObject({key:'forbidden'});await expect(publishClientDocument(reader,delegated,1,true)).rejects.toMatchObject({key:'forbidden'});
 await db.query("UPDATE membership SET role='READ_ONLY',module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
});
it('snapshots only public estimate/invoice fields and records signature without financial posting or automatic conversion',async()=>{
 const line={itemId:'',description:'Service public',quantity:'1',unitPrice:'100',accountId:W.sales,taxCodeId:W.taxCodeStandard};const raw={contactId:W.customer,issueDate:'2026-06-01',dueDate:'2999-01-01',reference:'Portal reference',terms:body,hourlyRate:'125.99',memo:'INTERNAL-SECRET-PORTAL',lines:[line]};
 const estimate=await saveEstimate(actor,raw);let quote=(await getEstimate(actor,estimate))!;expect(quote.terms.match(/125,99 CAD\/h/g)).toHaveLength(2);expect(quote.terms.length).toBeGreaterThan(4000);await transitionEstimate(actor,estimate,quote.revision,'SENT');
 const shared=await prepareSourceDocument(actor,'ESTIMATE',estimate,input.customerEmail,'fr-CA'),u=await publishClientDocument(actor,shared,1,true);const opened=(await openClientDocument(tokenOf(u),'192.0.2.30'))!;expect(opened.body).toContain('Service public');expect(opened.body).toContain('125,99 CAD/h');expect(opened.body).not.toContain('INTERNAL-SECRET-PORTAL');await signClientDocument(tokenOf(u),sign(opened.hash),'192.0.2.31');quote=(await getEstimate(actor,estimate))!;expect(quote.status).toBe('SENT');
 await transitionEstimate(actor,estimate,quote.revision,'CANCELLED');expect(await openClientDocument(tokenOf(u),'192.0.2.30')).toBeNull();
 const draft=await saveDraft(actor,{...raw,memo:'Public invoice payment instructions'}),invoiceDraft=(await getDraft(actor,draft))!;await postInvoice(actor,draft,invoiceDraft.revision,'2026-06-01');const posted=(await getInvoice(actor,draft))!;
 const invoiceShare=await prepareSourceDocument(actor,'INVOICE',posted.id,input.customerEmail,'en'),invoiceUrl=await publishClientDocument(actor,invoiceShare,1,true),invoiceToken=tokenOf(invoiceUrl);const before=(await db.query('SELECT count(*) AS n FROM journal_entry')).rows;const invoiceCopy=(await openClientDocument(invoiceToken,'192.0.2.32'))!;expect(invoiceCopy.body).toContain('Service public');expect(invoiceCopy.body).toContain('Public invoice payment instructions');expect(invoiceCopy.body).toContain('Portal reference');expect(invoiceCopy.body).not.toContain('INTERNAL-SECRET-PORTAL');await expect(signClientDocument(invoiceToken,sign(invoiceCopy.hash),'192.0.2.33')).rejects.toMatchObject({key:'contracts.signature'});expect((await db.query('SELECT count(*) AS n FROM journal_entry')).rows).toEqual(before);
 await expect(prepareSourceDocument(other,'INVOICE',posted.id,input.customerEmail,'en')).rejects.toMatchObject({key:'contracts.unavailable'});
});
it('sends a confirmed private link once per attempt, separates SMTP status from views and enforces cooldown',async()=>{
 const documentId=await saveContract(actor,input),u=await publishClientDocument(actor,documentId,1,true),attempt=randomUUID();const before=mail.mock.calls.length;
 await expect(sendClientDocument(actor,documentId,attempt,false)).rejects.toMatchObject({key:'contracts.confirm'});await sendClientDocument(actor,documentId,attempt,true);await sendClientDocument(actor,documentId,attempt,true);expect(mail.mock.calls.length).toBe(before+1);expect(JSON.stringify(mail.mock.calls.at(-1))).toContain(u);expect((await getClientDocument(actor,documentId))?.firstViewedAt).toBeNull();await expect(sendClientDocument(actor,documentId,randomUUID(),true)).rejects.toThrow();
});

it('keeps English rate/consent evidence and makes manually accepted estimates read-only for unsigned copies',async()=>{
 const english=await saveContract(actor,{...input,locale:'en'}),u=await publishClientDocument(actor,english,1,true),key=tokenOf(u),opened=(await openClientDocument(key,'192.0.2.50'))!;expect(opened.canSign).toBe(true);expect(opened.body.match(/125\.99 CAD\/h/g)).toHaveLength(2);const signed=await signClientDocument(key,sign(opened.hash),'192.0.2.51');expect(signed.consentText).toContain('agree to sign it electronically');expect(signed.canSign).toBe(false);
 const line={itemId:'',description:'Read-only accepted source',quantity:'1',unitPrice:'100',accountId:W.sales,taxCodeId:W.taxCodeStandard};const estimate=await saveEstimate(actor,{contactId:W.customer,issueDate:'2026-06-01',dueDate:'2999-01-01',lines:[line]});let q=(await getEstimate(actor,estimate))!;await transitionEstimate(actor,estimate,q.revision,'SENT');const document=await prepareSourceDocument(actor,'ESTIMATE',estimate,input.customerEmail,'en'),url=await publishClientDocument(actor,document,1,true);q=(await getEstimate(actor,estimate))!;await transitionEstimate(actor,estimate,q.revision,'ACCEPTED');expect((await openClientDocument(tokenOf(url),'192.0.2.52'))?.canSign).toBe(false);
});

it('serializes signature against cancellation of its source instead of signing a stale source state',async()=>{
 const line={itemId:'',description:'Concurrent source',quantity:'1',unitPrice:'100',accountId:W.sales,taxCodeId:W.taxCodeStandard};const estimate=await saveEstimate(actor,{contactId:W.customer,issueDate:'2026-06-01',dueDate:'2999-01-01',lines:[line]});const quote=(await getEstimate(actor,estimate))!;await transitionEstimate(actor,estimate,quote.revision,'SENT');const document=await prepareSourceDocument(actor,'ESTIMATE',estimate,input.customerEmail,'fr-CA'),url=await publishClientDocument(actor,document,1,true),token=tokenOf(url),opened=(await openClientDocument(token,'192.0.2.60'))!;
 let attempt:Promise<{error?:unknown;value?:unknown}>|undefined;
 await db.query('BEGIN');try{
  await db.query('SELECT id FROM sales_estimate WHERE id=$1 FOR UPDATE',[estimate]);
  attempt=signClientDocument(token,sign(opened.hash),'192.0.2.61').then(value=>({value}),error=>({error}));
  let blocked=false;for(let n=0;n<200;n++){await db.query('SELECT pg_stat_clear_snapshot()');const r=await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%client_document_public%') AS blocked");if(r.rows[0].blocked){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}expect(blocked).toBe(true);
  await db.query("UPDATE sales_estimate SET status='CANCELLED',updated_at=now() WHERE id=$1",[estimate]);await db.query('COMMIT');expect(await attempt).toMatchObject({error:{key:'contracts.unavailable'}});expect((await getClientDocument(actor,document))?.signedAt).toBeNull();
 }finally{await db.query('ROLLBACK');await attempt;}
});
it('accepts the same 200-character customer name limit in drafts and published contracts',async()=>{
 const customerName='C'.repeat(200),id=await saveContract(actor,{...input,customerName});const url=await publishClientDocument(actor,id,1,true);const d=(await openClientDocument(tokenOf(url),'192.0.2.70'))!;expect(d.customer).toBe(customerName);expect(d.body).toContain(customerName);await expect(saveContract(actor,{...input,customerName:'C'.repeat(201)})).rejects.toMatchObject({key:'contracts.invalid'});
});
