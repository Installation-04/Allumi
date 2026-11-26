import { can } from "@/modules/companies";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { getContractTemplate, getContractCopy } from "@/modules/contracts";
import { loadCompany } from "../../_lib";
import { ContractEditor } from "../editor";
import { saveContractAction } from "../actions";
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<{copier?:string|string[]}>}){
 const {company,actor,locale}=await loadCompany(params,'sales.manage'),t=await getTranslations('contracts'),query=await searchParams,base=`/c/${company.id}/contrats`;
 let initial:Record<string,string>,source:string|null=null;
 if(query.copier!==undefined){if(typeof query.copier!=='string'||!query.copier)notFound();const copy=await getContractCopy(actor,query.copier);if(!copy)notFound();initial=copy;source=query.copier;}
 else{const template=await getContractTemplate(actor);initial={title:'',customerName:'',customerEmail:'',locale,body:template?.body??'',hourlyRate:template?.hourlyRateCents?`${template.hourlyRateCents/100n}.${(template.hourlyRateCents%100n).toString().padStart(2,'0')}`:''};}
 return <section className="min-w-0 max-w-4xl space-y-5 break-words [overflow-wrap:anywhere]"><Link className="inline-flex min-h-11 items-center underline" href={base}>{t('back')}</Link><h1 className="text-2xl font-semibold">{t(source?'copyTitle':'new')}</h1><p>{t(source?'copyHint':'draftHint')}</p>{source&&<Link className="inline-flex min-h-11 items-center underline" href={`${base}/${source}`}>{t('copySource')}</Link>}<ContractEditor key={source??'template'} companyName={company.name} customerLookupCompanyId={can(company,'contact.read')?company.id:undefined} action={saveContractAction.bind(null,company.id,null,0)} initial={initial}/></section>;
}
