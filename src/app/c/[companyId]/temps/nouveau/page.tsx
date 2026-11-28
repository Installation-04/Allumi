import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectByCode } from "@/modules/projects";
import { AppError } from "@/platform/errors";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { getTranslations } from "@/platform/i18n/server";
import { loadCompany } from "../../_lib";
import { EntryFields } from "../fields";
import { createAction } from "../actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("time"))("create")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {company,actor,locale}=await loadCompany(params,"time.manage"),t=await getTranslations("time");
  const q=(await searchParams).dossier;let preset;
  if(q!==undefined){if(typeof q!=='string')notFound();preset=await getProjectByCode(actor,q).catch(e=>{if(e instanceof AppError&&['project.invalid','project.notFound'].includes(e.key))notFound();throw e;});if(preset.status!=='ACTIVE')notFound();}
  return <section className="max-w-xl space-y-5"><h1 className="text-2xl font-semibold">{t("create")}</h1><p className="text-sm">{t("shared")}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/temps`}>{t("back")}</Link><ActionForm action={createAction.bind(null,company.id)} label={t("save")} variant="primary"><EntryFields locale={locale} preset={preset}/></ActionForm></section>;
}
