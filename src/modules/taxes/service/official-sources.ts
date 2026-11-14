import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { todayIso } from "@/modules/ledger";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { officialScope, type OfficialPreview } from "../domain/official-sources";
import { fetchOfficialPreview } from "../connectors/official";
function scope(province:string,date:string){try{return officialScope(province,date,todayIso());}catch{throw new AppError("officialTaxes.invalid");}}
export async function getOfficialTaxPreview(actor:CompanyContext,province:string,date:string):Promise<OfficialPreview> {
  const input=scope(province,date);
  await withCompany(actor,tx=>requireRole(tx,"taxes.read"));
  const preview=await fetchOfficialPreview(input.province,input.date);
  await withCompany(actor,tx=>requireRole(tx,"taxes.read"));
  return preview;
}
const id=z.uuid(),optionalId=z.union([id,z.literal("")]).transform(v=>v||null);
const schema=z.object({province:z.string(),date:z.string(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),code:z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{0,9}$/),federalPayable:id,federalRecoverable:optionalId,qstPayable:z.union([id,z.literal("")]),qstRecoverable:optionalId,confirmed:z.literal("yes")}).strict();
/** Creates a new bundle atomically. Existing taxes, rates and posted documents are never updated. */
export async function importOfficialTaxes(actor:CompanyContext,input:unknown) {
  const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError("officialTaxes.invalid");
  const values=parsed.data,selected=scope(values.province,values.date);
  await withCompany(actor,async tx=>{await requireRole(tx,"taxes.manage");await requireRole(tx,"ledger.read");});
  const preview=await fetchOfficialPreview(selected.province,selected.date);
  if(preview.fingerprint!==values.fingerprint)throw new AppError("officialTaxes.changed");
  try {return await withCompany(actor,async tx=>{
    await requireRole(tx,"taxes.manage");await requireRole(tx,"ledger.read");
    const taxes:string[]=[];
    for(const source of preview.sources) {
      const qst=source.id==="RQ_QST",payable=qst?values.qstPayable:values.federalPayable,recoverable=qst?values.qstRecoverable:values.federalRecoverable;
      if(!payable)throw new AppError("catalog.reference");
      const ids=[payable,recoverable].filter((v):v is string=>!!v);
      const accounts=await tx.account.findMany({where:{companyId:actor.companyId,id:{in:ids},isActive:true,subtype:"SALES_TAX"}});
      if(new Set(ids).size!==ids.length||accounts.length!==ids.length||accounts.find(a=>a.id===payable)?.type!=="LIABILITY"||(recoverable&&accounts.find(a=>a.id===recoverable)?.type!=="ASSET"))throw new AppError("catalog.reference");
      const tax=await tx.tax.create({data:{companyId:actor.companyId,code:`${values.code}-${qst?"TVQ":"FED"}`,nameFr:`${qst?"TVQ":"TPS/TVH"} · ${selected.province}`,nameEn:`${qst?"QST":"GST/HST"} · ${selected.province}`,payableAccountId:payable,recoverableAccountId:recoverable}});
      for(const rate of source.rates)await tx.taxRate.create({data:{companyId:actor.companyId,taxId:tax.id,rate:rate.rate,effectiveFrom:new Date(`${rate.from}T00:00:00Z`),effectiveTo:rate.to?new Date(`${rate.to}T00:00:00Z`):null}});
      taxes.push(tax.id);
    }
    const code=await tx.taxCode.create({data:{companyId:actor.companyId,code:values.code,nameFr:`${selected.province==="QC"?"TPS et TVQ":"TPS/TVH"} · ${selected.province}`,nameEn:`${selected.province==="QC"?"GST and QST":"GST/HST"} · ${selected.province}`,treatment:"STANDARD"}});
    for(const [position,taxId] of taxes.entries())await tx.taxCodeComponent.create({data:{companyId:actor.companyId,taxCodeId:code.id,taxId,position:position+1}});
    await recordEvent(tx,{action:"tax.official_import",entityType:"tax_code",entityId:code.id,data:{code:values.code,province:preview.province,reviewDate:preview.date,fingerprint:preview.fingerprint,sources:preview.sources,taxIds:taxes}});
    return code.id;
  });}catch(error){if(isConflict(error))throw new AppError("catalog.conflict");throw toAppError(error);}
}
