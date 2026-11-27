import "server-only";
import { z } from "zod";
import { sha256Hex, hitRateLimit } from "@/modules/auth";
import { withAnonymous } from "@/platform/tenant";
import { AppError } from "@/platform/errors";
import { signatureInput, type PublicClientDocument } from "../domain/document";
import { sourceDocumentText } from "../domain/source";
import { clientDocumentPrintHtml } from "../domain/print-copy";
const tokenValid=(token:string)=>/^[A-Za-z0-9_-]{43}$/.test(token);
const publicSchema=z.object({id:z.uuid(),kind:z.enum(['CONTRACT','ESTIMATE','INVOICE']),title:z.string(),issuer:z.string(),customer:z.string(),recipient:z.string(),locale:z.enum(['fr-CA','en']),body:z.string(),payload:z.unknown().optional(),hash:z.string().regex(/^[0-9a-f]{64}$/),publishedAt:z.string(),expiresAt:z.string(),signedAt:z.string().nullable(),signerName:z.string().nullable(),signerEmail:z.string().nullable(),consentText:z.string().nullable(),canSign:z.boolean()});
const peekSchema=z.object({title:z.string(),issuer:z.string(),locale:z.enum(['fr-CA','en'])});
async function limit(ip:string,sign=false){if(!(await hitRateLimit(sign?'document-sign:ip':'document-read:ip',ip,{max:sign?10:120,windowSeconds:900})).allowed)throw new AppError('contracts.rateLimit');}
async function query(token:string,operation:'PEEK'|'OPEN'|'SIGN',input?:z.infer<typeof signatureInput>){
 const [row]=await withAnonymous(tx=>tx.$queryRaw<{value:unknown}[]>`SELECT client_document_public(${sha256Hex(token)},${operation},${input?.name??null},${input?.email??null},${input?.hash??null},${input?.consent??false}) AS value`);return row?.value??null;
}
export async function peekClientDocument(token:string,ip:string){if(!tokenValid(token))return null;await limit(ip);const value=await query(token,'PEEK');return value?peekSchema.parse(value):null;}
function document(value:unknown):PublicClientDocument|null {if(!value)return null;const {payload,...d}=publicSchema.parse(value);return {...d,body:d.kind==='CONTRACT'?d.body:sourceDocumentText(payload,d.locale)};}
export async function openClientDocument(token:string,ip:string){if(!tokenValid(token))return null;await limit(ip);return document(await query(token,'OPEN'));}
/** Downloading never invokes OPEN or SIGN, and rechecks the live bearer capability. */
export async function getPublicSignedDocumentCopy(token:string,ip:string){
 if(!tokenValid(token))return null;await limit(ip);
 const [row]=await withAnonymous(tx=>tx.$queryRaw<{value:unknown}[]>`SELECT client_document_public_copy(${sha256Hex(token)}) AS value`);
 if(!row?.value)return null;
 const raw=publicSchema.extend({firstViewedAt:z.string().nullable(),capturedAt:z.string()}).parse(row.value),d=document(raw)!;
 return {id:d.id,html:clientDocumentPrintHtml({capturedAt:raw.capturedAt,publication:{id:d.id,kind:d.kind,title:d.title,issuer:d.issuer,customer:d.customer,recipient:d.recipient,locale:d.locale,text:d.body,sha256:d.hash},events:{publishedAt:d.publishedAt,expiresAt:d.expiresAt,firstViewedAt:raw.firstViewedAt,signedAt:d.signedAt,revokedAt:null},signature:{name:d.signerName,email:d.signerEmail,consent:d.consentText}})};
}
export async function signClientDocument(token:string,raw:unknown,ip:string){
 if(!tokenValid(token))throw new AppError('contracts.unavailable');await limit(ip,true);const parsed=signatureInput.safeParse(raw);if(!parsed.success)throw new AppError('contracts.signature');
 try{const d=document(await query(token,'SIGN',parsed.data));if(!d)throw new AppError('contracts.unavailable');return d;}catch(e){if(e instanceof AppError)throw e;throw new AppError('contracts.signature');}
}
