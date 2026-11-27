import Link from "next/link";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { getTranslations } from "@/platform/i18n/server";
import { loadCompany } from "../../_lib";
import { EntryFields } from "../fields";
import { createAction } from "../actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("time"))("create")};}
export default async function Page({params}:{params:Promise<{companyId:string}>}) {
  const {company,locale}=await loadCompany(params,"time.manage"),t=await getTranslations("time");
  return <section className="max-w-xl space-y-5"><h1 className="text-2xl font-semibold">{t("create")}</h1><p className="text-sm">{t("shared")}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/temps`}>{t("back")}</Link><ActionForm action={createAction.bind(null,company.id)} label={t("save")} variant="primary"><EntryFields locale={locale}/></ActionForm></section>;
}
