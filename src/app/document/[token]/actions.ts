"use server";
import { clientIp } from "@/app/_lib/session";
import { openClientDocument,signClientDocument,type PublicClientDocument } from "@/modules/contracts";
import { AppError } from "@/platform/errors";
export type PortalState={document?:PublicClientDocument;error?:'signatureError'|'unavailable'|'rateLimit'|'portalError';values?:Record<string,string>}|undefined;
export async function documentAction(token:string,_previous:PortalState,form:FormData):Promise<PortalState>{
 const ip=await clientIp(),values={name:String(form.get('name')??''),email:String(form.get('email')??'')};
 try{const operation=form.get('operation');if(operation==='OPEN'&&form.getAll('operation').length===1){const document=await openClientDocument(token,ip);return document?{document}:{error:'unavailable'};}
 if(operation!=='SIGN'||['name','email','hash','consent','operation'].some(n=>form.getAll(n).length!==1||typeof form.get(n)!=='string'))throw new AppError('contracts.signature');
 const document=await signClientDocument(token,{name:values.name.trim(),email:values.email.trim().toLowerCase(),hash:form.get('hash'),consent:form.get('consent')==='yes'},ip);return {document};
 }catch(e){if(e instanceof AppError&&e.key==='contracts.rateLimit')return {error:'rateLimit',values};let document;try{document=await openClientDocument(token,ip)??undefined;}catch{}return {document,values,error:e instanceof AppError&&e.key==='contracts.signature'?'signatureError':e instanceof AppError&&e.key==='contracts.unavailable'?'unavailable':'portalError'};}
}
