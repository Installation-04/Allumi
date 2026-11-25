import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { getContractTemplate } from "@/modules/contracts";
import { loadCompany } from "../../_lib";
import { ContractEditor } from "../editor";
import { saveContractAction } from "../actions";
export default async function Page({params}:{params:Promise<{companyId:string}>}){const {company,actor,locale}=await loadCompany(params,'sales.manage'),t=await getTranslations('contracts'),template=await getContractTemplate(actor);return <section className="max-w-4xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/contrats`}>{t('back')}</Link><h1 className="text-2xl font-semibold">{t('new')}</h1><p>{t('draftHint')}</p><ContractEditor companyName={company.name} action={saveContractAction.bind(null,company.id,null,0)} initial={{title:'',customerName:'',customerEmail:'',locale,body:template?.body??'',hourlyRate:template?.hourlyRateCents?`${template.hourlyRateCents/100n}.${(template.hourlyRateCents%100n).toString().padStart(2,'0')}`:''}}/></section>;}
