import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { newToken, sha256Hex } from "@/modules/auth";
import { getEstimate, getInvoice, parseHourlyRate, renderDocumentTemplate, templateText } from "@/modules/sales";
import { decrypt, encrypt } from "@/platform/secrets";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { env } from "@/platform/env";
import { deliverMail, mailConfigured, requireMailConfigured } from "@/platform/mail";
import { contractInput, type ContractInput } from "../domain/document";
import { documentStage, documentLinkState, trackingFilters } from "../domain/tracking";
import { trackingRows } from "./tracking";

const kindSchema=z.enum(['CONTRACT','ESTIMATE','INVOICE']),statusSchema=z.enum(['DRAFT','PUBLISHED']);
const uuid=(id:string)=>{if(!z.uuid().safeParse(id).success)throw new AppError("contracts.invalid");};
function rate(value:string){if(!value.trim())return null;const parsed=parseHourlyRate(value);if(parsed===null)throw new AppError("contracts.rate");return parsed;}
function render(body:string,hourly:bigint|null,locale:string,customer:string,issuer:string){try{return renderDocumentTemplate(body,hourly,locale,customer,issuer);}catch{throw new AppError("contracts.variables");}}
const binding=(companyId:string,id:string)=>({purpose:"client-document-link",context:`${companyId}:${id}`});
const link=(token:string)=>new URL(`/document/${token}`,env().APP_URL).href;
async function manage(tx:Tx){await requireRole(tx,"sales.manage");}
async function locked(tx:Tx,actor:CompanyContext,id:string,revision?:number){
 uuid(id);const [v]=await tx.$queryRaw<{revision:number}[]>`SELECT revision FROM client_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
 if(!v)throw new AppError("contracts.notFound");if(revision!==undefined&&(!Number.isSafeInteger(revision)||v.revision!==revision))throw new AppError("contracts.stale");
 return tx.clientDocument.findFirstOrThrow({where:{companyId:actor.companyId,id}});
}
export async function getContractTemplate(actor:CompanyContext){return withCompany(actor,async tx=>{await requireRole(tx,"sales.read");return tx.contractTemplate.findFirst({where:{companyId:actor.companyId}});});}
export async function saveContractTemplate(actor:CompanyContext,body:string,hourlyRate:string,revision:number){
 const parsed=templateText.safeParse(body);if(!parsed.success||!Number.isSafeInteger(revision)||revision<0)throw new AppError("contracts.invalid");const hourlyRateCents=rate(hourlyRate);
 render(parsed.data,hourlyRateCents??100n,"fr-CA","Client","Entreprise");
 try{return await withCompany(actor,async tx=>{await manage(tx);if(revision===0)return tx.contractTemplate.create({data:{companyId:actor.companyId,body:parsed.data,hourlyRateCents}});
 const result=await tx.contractTemplate.updateMany({where:{companyId:actor.companyId,revision},data:{body:parsed.data,hourlyRateCents,revision:revision+1}});if(result.count!==1)throw new AppError("contracts.stale");});}catch(e){if(isConflict(e))throw new AppError("contracts.stale");throw toAppError(e);}
}
/** Read-only prefill for a new independent draft; never select access or signature evidence. */
export async function getContractCopy(actor:CompanyContext,id:string){
 return withCompany(actor,async tx=>{await manage(tx);if(!z.uuid().safeParse(id).success)return null;
 const d=await tx.clientDocument.findFirst({where:{companyId:actor.companyId,id,kind:'CONTRACT'},select:{title:true,customerName:true,customerEmail:true,locale:true,body:true,hourlyRateCents:true}});if(!d)return null;
 return {title:d.title,customerName:d.customerName,customerEmail:d.customerEmail,locale:z.enum(['fr-CA','en']).parse(d.locale),body:d.body,hourlyRate:d.hourlyRateCents===null?'':`${d.hourlyRateCents/100n}.${(d.hourlyRateCents%100n).toString().padStart(2,'0')}`};
 });
}
export async function saveContract(actor:CompanyContext,input:ContractInput,id?:string,revision?:number){
 const parsed=contractInput.safeParse(input);if(!parsed.success)throw new AppError("contracts.invalid");const data=parsed.data,hourlyRateCents=rate(data.hourlyRate);
 return withCompany(actor,async tx=>{await manage(tx);const company=await tx.company.findFirstOrThrow({where:{id:actor.companyId},select:{name:true}});render(data.body,hourlyRateCents,data.locale,data.customerName,company.name);
 const values={title:data.title,customerName:data.customerName,customerEmail:data.customerEmail.toLowerCase(),issuerName:company.name,locale:data.locale,body:data.body,hourlyRateCents};
 if(!id)return (await tx.clientDocument.create({data:{companyId:actor.companyId,kind:"CONTRACT",createdById:actor.userId,...values},select:{id:true}})).id;
 const previous=await locked(tx,actor,id,revision);if(previous.status!=="DRAFT"||previous.kind!=="CONTRACT")throw new AppError("contracts.immutable");if((await tx.clientDocument.updateMany({where:{companyId:actor.companyId,id,revision:previous.revision},data:{...values,revision:previous.revision+1}})).count!==1)throw new AppError("contracts.stale");return id;
 });
}
async function validateSourceAccess(actor:CompanyContext,kind:"ESTIMATE"|"INVOICE",sourceId:string,recipient:string,locale:"fr-CA"|"en"){
 uuid(sourceId);const email=z.email().max(254).safeParse(recipient);if(!email.success||!['ESTIMATE','INVOICE'].includes(kind)||!['fr-CA','en'].includes(locale))throw new AppError("contracts.invalid");
 return withCompany(actor,async tx=>{await manage(tx);});
}
/** Source content is copied by the SQL publication guard, never from user-provided text or private notes. */
export async function prepareSourceDocument(actor:CompanyContext,kind:"ESTIMATE"|"INVOICE",sourceId:string,recipient:string,locale:"fr-CA"|"en"){
 await validateSourceAccess(actor,kind,sourceId,recipient,locale);
 const source=kind==="ESTIMATE"?await getEstimate(actor,sourceId):await getInvoice(actor,sourceId);
 if(!source||kind==="ESTIMATE"&&(source.status!=="SENT"||'expired' in source&&source.expired)||kind==="INVOICE"&&source.status!=="POSTED")throw new AppError("contracts.unavailable");
 const snapshot='billingSnapshot' in source?source.billingSnapshot:source.customerSnapshot;
 const customer=typeof snapshot==='object'&&snapshot!==null&&!Array.isArray(snapshot)&&typeof snapshot.name==='string'?snapshot.name:'Client';
 return withCompany(actor,async tx=>{await manage(tx);const company=await tx.company.findFirstOrThrow({where:{id:actor.companyId},select:{name:true}});
 return (await tx.clientDocument.create({data:{companyId:actor.companyId,kind,sourceEstimateId:kind==="ESTIMATE"?sourceId:null,sourceInvoiceId:kind==="INVOICE"?sourceId:null,title:(source.number??kind).slice(0,160),customerName:customer,customerEmail:recipient.toLowerCase(),issuerName:company.name,locale,body:"",createdById:actor.userId},select:{id:true}})).id;});
}
export async function publishClientDocument(actor:CompanyContext,id:string,revision:number,confirmed:boolean){
 if(confirmed!==true)throw new AppError("contracts.confirm");const token=newToken();
 try{return await withCompany(actor,async tx=>{await manage(tx);const d=await locked(tx,actor,id,revision);if(d.status!=="DRAFT")throw new AppError("contracts.immutable");
 const result=await tx.clientDocument.updateMany({where:{companyId:actor.companyId,id,revision},data:{status:"PUBLISHED",tokenHash:sha256Hex(token),tokenCipher:encrypt(token,binding(actor.companyId,id)),expiresAt:new Date(Date.now()+90*86400000),revision:revision+1}});if(result.count!==1)throw new AppError("contracts.stale");return link(token);});}catch(e){throw toAppError(e);}
}
export async function revokeClientDocument(actor:CompanyContext,id:string,revision:number,confirmed:boolean){
 if(confirmed!==true)throw new AppError("contracts.confirm");return withCompany(actor,async tx=>{await manage(tx);const d=await locked(tx,actor,id,revision);if(d.status!=="PUBLISHED"||d.revokedAt)throw new AppError("contracts.unavailable");if((await tx.clientDocument.updateMany({where:{companyId:actor.companyId,id,revision},data:{revokedAt:new Date(),revision:revision+1}})).count!==1)throw new AppError("contracts.stale");});
}
export async function getClientDocument(actor:CompanyContext,id:string){if(!z.uuid().safeParse(id).success)return null;return withCompany(actor,async tx=>{
 await requireRole(tx,"sales.read");let writable=false;try{await manage(tx);writable=true;}catch(e){if(!(e instanceof AppError&&e.key==="forbidden"))throw e;}
 const d=await tx.clientDocument.findFirst({where:{companyId:actor.companyId,id},select:{id:true,kind:true,sourceEstimateId:true,sourceInvoiceId:true,title:true,customerName:true,customerEmail:true,issuerName:true,locale:true,body:true,hourlyRateCents:true,status:true,renderedBody:true,sourceSnapshot:true,contentHash:true,publishedAt:true,expiresAt:true,revokedAt:true,firstViewedAt:true,signedAt:true,signerName:true,signerEmail:true,consentText:true,revision:true,createdAt:true,sourceEstimate:{select:{status:true}},sourceInvoice:{select:{status:true}}}});if(!d)return null;
 const sourceAvailable=d.kind==="CONTRACT"||d.kind==="ESTIMATE"&&!!d.sourceEstimate&&["SENT","ACCEPTED","CONVERTED"].includes(d.sourceEstimate.status)||d.kind==="INVOICE"&&d.sourceInvoice?.status==="POSTED";
 const linkState=documentLinkState(d,sourceAvailable);
 let url:string|null=null;if(writable&&linkState==="AVAILABLE"){const [secret]=await tx.$queryRaw<{cipher:Uint8Array}[]>`SELECT token_cipher AS cipher FROM client_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND status='PUBLISHED' AND revoked_at IS NULL AND expires_at>statement_timestamp() AND (SELECT app_module_level('sales'))='write' AND (kind='CONTRACT' OR kind='ESTIMATE' AND EXISTS(SELECT 1 FROM sales_estimate e WHERE e.company_id=client_document.company_id AND e.id=client_document.source_estimate_id AND e.status IN ('SENT','ACCEPTED','CONVERTED')) OR kind='INVOICE' AND EXISTS(SELECT 1 FROM sales_document i WHERE i.company_id=client_document.company_id AND i.id=client_document.source_invoice_id AND i.status='POSTED'))`;if(secret?.cipher)url=link(decrypt(secret.cipher,binding(actor.companyId,id)));}
 const deliveries=await tx.clientDocumentDelivery.findMany({where:{companyId:actor.companyId,documentId:id},orderBy:[{createdAt:"desc"},{id:"desc"}],take:20,select:{id:true,recipient:true,status:true,createdAt:true,completedAt:true}});
 return {...d,kind:kindSchema.parse(d.kind),status:statusSchema.parse(d.status),url,writable,deliveries,stage:documentStage(d),linkState,sourceAvailable,mailConfigured:mailConfigured()};
});}
export async function listClientDocuments(actor:CompanyContext,q="",page=1,filters:{kind?:string;stage?:string;link?:string}={}){
 q=q.trim();const parsed=trackingFilters.safeParse(filters);if(!parsed.success||[...q].length>120||/[\p{Cc}]/u.test(q)||!Number.isSafeInteger(page)||page<1||page>1000)throw new AppError("contracts.invalid");
 return withCompany(actor,async tx=>{await requireRole(tx,"sales.read");const rows=await trackingRows(tx,actor.companyId,q,parsed.data,51,(page-1)*50);return {rows:rows.slice(0,50),hasMore:rows.length>50,page};});
}
async function requireAvailableSource(tx:Tx,d:{kind:string;companyId:string;sourceEstimateId:string|null;sourceInvoiceId:string|null}){
 if(d.kind==='CONTRACT')return;
 const rows=d.kind==='ESTIMATE'?await tx.$queryRaw<{id:string}[]>`SELECT id FROM sales_estimate WHERE company_id=${d.companyId}::uuid AND id=${d.sourceEstimateId}::uuid AND status IN ('SENT','ACCEPTED','CONVERTED') FOR SHARE`:await tx.$queryRaw<{id:string}[]>`SELECT id FROM sales_document WHERE company_id=${d.companyId}::uuid AND id=${d.sourceInvoiceId}::uuid AND status='POSTED' FOR SHARE`;
 if(rows.length!==1)throw new AppError('contracts.unavailable');
}
export async function sendClientDocument(actor:CompanyContext,id:string,attemptId:string,confirmed:boolean){
 uuid(id);uuid(attemptId);if(confirmed!==true)throw new AppError("contracts.confirm");
 const reserved=await withCompany(actor,async tx=>{await manage(tx);const d=await locked(tx,actor,id);const existing=await tx.clientDocumentDelivery.findFirst({where:{companyId:actor.companyId,id:attemptId}});if(existing){if(existing.documentId!==id)throw new AppError("contracts.invalid");return {existing};}
 if(d.status!=="PUBLISHED"||d.revokedAt||!d.expiresAt||d.expiresAt<=new Date()||!d.tokenCipher)throw new AppError("contracts.unavailable");await requireAvailableSource(tx,d);requireMailConfigured();
 const attempts=await tx.clientDocumentDelivery.findMany({where:{companyId:actor.companyId,documentId:id},orderBy:{createdAt:'desc'},take:20});const now=Date.now();if(attempts.some(a=>a.createdAt.getTime()>now-60000)||attempts.filter(a=>a.createdAt.getTime()>now-86400000).length>=20)throw new AppError('contracts.mailRate');
 const attempt=await tx.clientDocumentDelivery.create({data:{id:attemptId,companyId:actor.companyId,documentId:id,recipient:d.customerEmail,locale:d.locale,createdById:actor.userId}});
 const url=link(decrypt(d.tokenCipher,binding(actor.companyId,id))),en=d.locale==="en",subject=(d.issuerName+" · "+d.title).replace(/[\r\n\x00-\x1f\x7f]/g," ").slice(0,200),text=[d.issuerName,d.title,"",en?"View the document using this private link. Contracts and estimates can be signed after review.":"Consultez le document avec ce lien privé. Les contrats et soumissions peuvent être signés après consultation.",url,"",en?"Anyone with this link can access the document. Please do not forward it.":"Toute personne disposant du lien peut accéder au document. Veuillez ne pas le transférer."].join("\n");
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 return {attempt,message:{to:d.customerEmail,subject,text,html:`<p>${escape(d.issuerName)}</p><p>${escape(d.title)}</p><p><a href="${escape(url)}">${en?"View document":"Consulter le document"}</a></p>`,attemptId}};
 });
 if(reserved.existing)return reserved.existing;
 const status=await deliverMail(reserved.message!);
 try{return await withCompany(actor,async tx=>{await manage(tx);return tx.clientDocumentDelivery.update({where:{companyId:actor.companyId,id:attemptId},data:{status,completedAt:new Date()}});});}catch{throw new AppError("invoiceEmail.uncertain");}
}
export const newDeliveryId=()=>randomUUID();

export async function sourceClientDocuments(actor:CompanyContext,kind:'ESTIMATE'|'INVOICE',sourceId:string){uuid(sourceId);if(!['ESTIMATE','INVOICE'].includes(kind))throw new AppError('contracts.invalid');return withCompany(actor,async tx=>{await requireRole(tx,'sales.read');return trackingRows(tx,actor.companyId,"",{},20,0,sourceId,kind);});}
