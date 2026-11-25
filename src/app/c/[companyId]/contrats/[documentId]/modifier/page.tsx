import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { getClientDocument } from "@/modules/contracts";
import { loadCompany } from "../../../_lib";
import { ContractEditor } from "../../editor";
import { saveContractAction } from "../../actions";
export default async function Page({params}:{params:Promise<{companyId:string;documentId:string}>}){const {company,actor}=await loadCompany(params,'sales.manage'),{documentId}=await params,t=await getTranslations('contracts'),d=await getClientDocument(actor,documentId);if(!d||d.status!=='DRAFT'||d.kind!=='CONTRACT')notFound();return <section className="max-w-4xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/contrats/${d.id}`}>{t('back')}</Link><h1 className="text-2xl font-semibold">{t('edit')}</h1><ContractEditor companyName={company.name} action={saveContractAction.bind(null,company.id,d.id,d.revision)} initial={{title:d.title,customerName:d.customerName,customerEmail:d.customerEmail,body:d.body,locale:d.locale,hourlyRate:d.hourlyRateCents?`${d.hourlyRateCents/100n}.${(d.hourlyRateCents%100n).toString().padStart(2,'0')}`:''}}/></section>;}
