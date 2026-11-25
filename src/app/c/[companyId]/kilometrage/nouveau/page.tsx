import Link from "next/link";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { getTranslations } from "@/platform/i18n/server";
import { loadCompany } from "../../_lib";
import { TripFields } from "../fields";
import { createAction } from "../actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("mileage"))("create")};}
export default async function Page({params}:{params:Promise<{companyId:string}>}) {
  const {company,locale}=await loadCompany(params,"mileage.manage"),t=await getTranslations("mileage");
  return <section className="max-w-xl space-y-5"><h1 className="text-2xl font-semibold">{t("create")}</h1><p className="text-sm">{t("shared")}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/kilometrage`}>{t("back")}</Link><ActionForm action={createAction.bind(null,company.id)} label={t("save")} variant="primary"><TripFields locale={locale}/></ActionForm></section>;
}
