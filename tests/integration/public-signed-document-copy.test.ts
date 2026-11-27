import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { getPublicSignedDocumentCopy, saveContract, publishClientDocument, openClientDocument, signClientDocument, revokeClientDocument, getClientDocument, prepareSourceDocument } from "@/modules/contracts";
import { hitRateLimit, sha256Hex } from "@/modules/auth";
import { saveEstimate, getEstimate, transitionEstimate, convertEstimate, saveDraft, getDraft, postInvoice } from "@/modules/sales";
import { owner } from "./helpers";
import { W, seedWorld, appClient } from "./world";
let db:pg.Client,app:pg.Client;
const actor={userId:W.userOwnerA,companyId:W.companyA},email="copy108@example.test",ip="192.0.2.108";
const input={title:"Contrat «été» 🪷",customerName:"Camille Copie",customerEmail:email,body:"{{client_name}}\n{{hourly_rate}}\n<script>alert('unsafe')</script>\nConditions & modalités",hourlyRate:"125.99",locale:"fr-CA" as "fr-CA"|"en"};
const token=(url:string)=>new URL(url).pathname.split('/').at(-1)!;
const counts=async()=>(await db.query("SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments,(SELECT count(*) FROM client_document_delivery)::text AS deliveries")).rows;
const state=async(id:string)=>(await db.query("SELECT revision,updated_at,first_viewed_at,signed_at,signer_name,signer_email,consent_text,content_hash FROM client_document WHERE id=$1",[id])).rows;
async function sign(t:string){const d=(await openClientDocument(t,ip))!;await signClientDocument(t,{name:"Camille déclarée",email,consent:true,hash:d.hash},ip);}
async function contract(locale:"fr-CA"|"en"="fr-CA",signed=true){const id=await saveContract(actor,{...input,locale}),t=token(await publishClientDocument(actor,id,1,true));if(signed)await sign(t);return{id,t};}
beforeAll(async()=>{db=await owner();await seedWorld(db);app=await appClient();await db.query("UPDATE account SET system_key='ACCOUNTS_RECEIVABLE' WHERE id=$1",[W.receivable]);await db.query("INSERT INTO number_sequence(company_id,key,prefix,padding,next_value) VALUES($1,'INVOICE','FAC-',5,1),($1,'JOURNAL_ENTRY','J-',5,1)",[W.companyA]);});
afterAll(async()=>{await app?.end();await db?.end();});
it("exports a signed FR/EN contract anonymously without business mutations or capability secrets",async()=>{
 for(const locale of ["fr-CA","en"] as const){const f=await contract(locale),before=await counts(),original=await state(f.id),copy=(await getPublicSignedDocumentCopy(f.t,ip))!;
  expect(copy.id).toBe(f.id);expect(copy.html).toContain(`<html lang="${locale}">`);expect(copy.html).toContain("Camille déclarée");expect(copy.html).toContain("&lt;script&gt;");expect(copy.html).not.toContain("<script>");expect(copy.html).toContain("Conditions &amp; modalités");expect(copy.html).toContain(original[0].content_hash);expect(copy.html).toContain(locale==="en"?"Declared signature":"Signature déclarée");expect(copy.html).not.toContain(f.t);expect(copy.html).not.toContain("canonicalPayload");expect(copy.html).not.toContain(W.companyA);expect(copy.html).not.toContain("source_snapshot");expect(await counts()).toEqual(before);expect(await state(f.id)).toEqual(original);
  // Anonymous table access remains empty: only the bearer function grants this one document.
  expect((await app.query("SELECT id FROM client_document")).rows).toHaveLength(0);
  const raw=(await app.query("SELECT client_document_public_copy($1) AS value",[sha256Hex(f.t)])).rows[0].value;expect(raw.id).toBe(f.id);expect(raw).not.toHaveProperty("token_hash");expect(raw).not.toHaveProperty("token_cipher");
 }
});
it("refuses unknown, malformed, draft and unsigned capabilities without recording a view",async()=>{
 const f=await contract("en",false),draft=await saveContract(actor,input),before=await counts(),original=await state(f.id);
 for(const t of ["bad", "_".repeat(43),f.t])expect(await getPublicSignedDocumentCopy(t,ip)).toBeNull();
 expect((await app.query("SELECT client_document_public_copy(NULL) AS value")).rows[0].value).toBeNull();expect((await app.query("SELECT client_document_public_copy('invalid') AS value")).rows[0].value).toBeNull();expect((await state(draft))[0].signed_at).toBeNull();expect(await state(f.id)).toEqual(original);expect(await counts()).toEqual(before);
});
it("rechecks revocation and expiry even when a signed copy was downloaded earlier",async()=>{
 const revoked=await contract();expect(await getPublicSignedDocumentCopy(revoked.t,ip)).not.toBeNull();await revokeClientDocument(actor,revoked.id,(await getClientDocument(actor,revoked.id))!.revision,true);const before=await counts();expect(await getPublicSignedDocumentCopy(revoked.t,ip)).toBeNull();
 const expired=await contract();await db.query("UPDATE client_document SET expires_at=published_at+interval '1 microsecond',revision=revision+1 WHERE id=$1",[expired.id]);const original=await state(expired.id),afterSetup=await counts();expect(await getPublicSignedDocumentCopy(expired.t,ip)).toBeNull();expect((await app.query("SELECT client_document_public_copy($1) AS value",[sha256Hex(expired.t)])).rows[0].value).toBeNull();expect(await state(expired.id)).toEqual(original);expect(await counts()).toEqual(afterSetup);expect(Number(before[0].entries)).toBe(Number(afterSetup[0].entries));
});
it("supports signed sent/accepted/converted estimate sources while refusing cancellation and invoices",async()=>{
 const lines=[{description:"Service publié",quantity:"1",unitPrice:"100",accountId:W.sales,taxCodeId:W.taxCodeStandard}],estimate=await saveEstimate(actor,{contactId:W.customer,issueDate:"2026-06-01",dueDate:"2999-01-01",lines,memo:"PRIVATE-COPY-108"});await transitionEstimate(actor,estimate,(await getEstimate(actor,estimate))!.revision,"SENT");const id=await prepareSourceDocument(actor,"ESTIMATE",estimate,email,"en"),t=token(await publishClientDocument(actor,id,1,true));await sign(t);
 for(const status of ["SENT","ACCEPTED","CONVERTED"] as const){if(status==="ACCEPTED")await transitionEstimate(actor,estimate,(await getEstimate(actor,estimate))!.revision,status);if(status==="CONVERTED")await convertEstimate(actor,estimate,(await getEstimate(actor,estimate))!.revision,"2026-06-01","2026-07-01");const before=await counts(),copy=(await getPublicSignedDocumentCopy(t,ip))!;expect(copy.html).toContain("Service publié");expect(copy.html).not.toContain("PRIVATE-COPY-108");expect(await counts()).toEqual(before);}
 const cancelled=await saveEstimate(actor,{contactId:W.customer,issueDate:"2026-06-01",dueDate:"2999-01-01",lines});await transitionEstimate(actor,cancelled,(await getEstimate(actor,cancelled))!.revision,"SENT");const share=await prepareSourceDocument(actor,"ESTIMATE",cancelled,email,"en"),ct=token(await publishClientDocument(actor,share,1,true));await sign(ct);await transitionEstimate(actor,cancelled,(await getEstimate(actor,cancelled))!.revision,"CANCELLED");expect(await getPublicSignedDocumentCopy(ct,ip)).toBeNull();
 const invoice=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-01",dueDate:"2026-07-01",lines});await postInvoice(actor,invoice,(await getDraft(actor,invoice))!.revision,"2026-06-01");const invoiceShare=await prepareSourceDocument(actor,"INVOICE",invoice,email,"en"),it=token(await publishClientDocument(actor,invoiceShare,1,true));expect(await getPublicSignedDocumentCopy(it,ip)).toBeNull();
});
it("fails closed on a corrupted publication before rendering any client content",async()=>{
 const f=await contract(),original=(await db.query("SELECT rendered_body FROM client_document WHERE id=$1",[f.id])).rows[0].rendered_body;
 const replace=async(body:string)=>{await db.query("BEGIN");try{await db.query("ALTER TABLE client_document DISABLE TRIGGER client_document_guard");await db.query("UPDATE client_document SET rendered_body=$2 WHERE id=$1",[f.id,body]);await db.query("ALTER TABLE client_document ENABLE TRIGGER client_document_guard");await db.query("COMMIT");}catch(e){await db.query("ROLLBACK");throw e;}};
 try{await replace("CORRUPTED-COPY-108");const before=await counts();expect(await getPublicSignedDocumentCopy(f.t,ip)).toBeNull();expect((await app.query("SELECT client_document_public_copy($1) AS value",[sha256Hex(f.t)])).rows[0].value).toBeNull();expect(await counts()).toEqual(before);}finally{await replace(original);}expect(await getPublicSignedDocumentCopy(f.t,ip)).not.toBeNull();
});
it("shares the portal read quota rather than creating an unlimited download path",async()=>{
 const f=await contract(),limited="192.0.2.208";for(let i=0;i<120;i++)await hitRateLimit("document-read:ip",limited,{max:120,windowSeconds:900});const before=await counts();await expect(getPublicSignedDocumentCopy(f.t,limited)).rejects.toMatchObject({key:"contracts.rateLimit"});expect(await counts()).toEqual(before);
});
