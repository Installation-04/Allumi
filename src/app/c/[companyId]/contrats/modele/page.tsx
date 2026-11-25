import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { getContractTemplate } from "@/modules/contracts";
import { loadCompany } from "../../_lib";
import { ContractEditor } from "../editor";
import { saveTemplateAction } from "../actions";
export default async function Page({params}:{params:Promise<{companyId:string}>}){const {company,actor,locale}=await loadCompany(params,'sales.manage'),t=await getTranslations('contracts'),template=await getContractTemplate(actor);return <section className="max-w-4xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/contrats`}>{t('back')}</Link><h1 className="text-2xl font-semibold">{t('template')}</h1><p>{t('templateHint')}</p><ContractEditor template companyName={company.name} action={saveTemplateAction.bind(null,company.id,template?.revision??0)} initial={{body:template?.body??'',locale,hourlyRate:template?.hourlyRateCents?`${template.hourlyRateCents/100n}.${(template.hourlyRateCents%100n).toString().padStart(2,'0')}`:''}}/></section>;}
