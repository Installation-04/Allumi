import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { getTranslations } from "@/platform/i18n/server";
import { AppError } from "@/platform/errors";
import { can } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { getMileageTrip, kilometers, mileageQuery, tripYearFilters } from "@/modules/mileage";
import { loadCompany } from "../../_lib";
import { TripFields } from "../fields";
import { updateAction,deleteAction } from "../actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("mileage"))("detail")};}
export default async function Page({params}:{params:Promise<{companyId:string;tripId:string}>}) {
  const {company,actor,locale}=await loadCompany(params,"mileage.read"),{tripId}=await params,t=await getTranslations("mileage");
  const trip=await getMileageTrip(actor,tripId).catch(e=>{if(e instanceof AppError&&e.key==='mileage.notFound')notFound();throw e;});
  const path=`/c/${company.id}/kilometrage`,edit=can(company,"mileage.manage");
  return <section className="max-w-3xl space-y-5 break-words"><h1 className="text-2xl font-semibold">{t("detail")}</h1><p className="text-sm">{t("shared")}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${path}?${mileageQuery(tripYearFilters(trip.date,todayIso()))}`}>{t("backYear")}</Link>
    <dl className="grid gap-2 rounded-lg border border-stone-300 p-4 text-sm dark:border-stone-700 sm:grid-cols-[auto_minmax(0,1fr)]">{(['date','vehicle','usage','origin','destination','purpose','distance'] as const).map(key=><div className="contents" key={key}><dt className="font-semibold">{t(key)}</dt><dd>{key==='usage'?t(trip.usage):key==='distance'?kilometers(trip.distanceMeters,locale)+' km':trip[key]||'—'}</dd></div>)}</dl>
    {edit&&<><details className="rounded-lg border border-stone-300 p-4 dark:border-stone-700"><summary className={`inline-flex min-h-11 cursor-pointer items-center font-semibold ${FOCUS}`}>{t("edit")}</summary><div className="mt-4 max-w-xl"><ActionForm action={updateAction.bind(null,company.id,trip.id,trip.revision)} label={t("update")} variant="primary"><TripFields trip={trip} locale={locale}/></ActionForm></div></details>
    <details className="rounded-lg border border-stone-300 p-4 dark:border-stone-700"><summary className={`inline-flex min-h-11 cursor-pointer items-center font-semibold ${FOCUS}`}>{t("delete")}</summary><ActionForm action={deleteAction.bind(null,company.id,trip.id,trip.revision)} label={t("deleteButton")}><label className="flex min-h-11 items-start gap-2 py-2"><input type="checkbox" name="confirmed" value="yes" required className={`mt-1 h-5 w-5 shrink-0 ${FOCUS}`}/><span>{t("deleteConfirm")}</span></label></ActionForm></details></>}
    <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${path}/${trip.id}`}>{t("reload")}</Link><p className="text-sm text-stone-600 dark:text-stone-400">{t("limits")}</p>
  </section>;
}
