import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext,type Tx } from "@/platform/tenant";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT={id:true,displayName:true,isActive:true} as const;
export const LEDGER_CONTACT_LIMIT=100;
/** Authorized accounting/contact readers see only the minimal identity already shown on journal lines. */
export async function requireLedgerContact(tx:Tx,companyId:string,contactId?:string|null){
 if(contactId==null)return null;
 await requireRole(tx,"contact.read");
 if(!UUID.test(contactId))throw new AppError("reports.contact");
 const contact=await tx.contact.findFirst({where:{companyId,id:contactId},select:SELECT});
 if(!contact)throw new AppError("reports.contact");
 return contact;
}
export async function findLedgerContact(actor:CompanyContext,id:string){
 if(!UUID.test(id))throw new AppError("reports.contact");
 return withCompany(actor,async tx=>{await requireRole(tx,"ledger.read");await requireRole(tx,"contact.read");return tx.contact.findFirst({where:{companyId:actor.companyId,id},select:SELECT});});
}
export async function listLedgerContacts(actor:CompanyContext,query=""){
 const term=query.trim().slice(0,120).replace(/[\\%_]/g,"\\$&");
 return withCompany(actor,async tx=>{
  await requireRole(tx,"ledger.read");await requireRole(tx,"contact.read");
  const contacts=await tx.contact.findMany({where:{companyId:actor.companyId,journalLines:{some:{companyId:actor.companyId}},...(term?{displayName:{contains:term,mode:"insensitive" as const}}:{})},select:SELECT,orderBy:[{displayName:"asc"},{id:"asc"}],take:LEDGER_CONTACT_LIMIT+1});
  return {contacts:contacts.slice(0,LEDGER_CONTACT_LIMIT),hasMore:contacts.length>LEDGER_CONTACT_LIMIT};
 });
}
