import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { can } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { listForecastPresets, FORECAST_HORIZONS, FORECAST_DELAYS, MAX_FORECAST_PRESETS, forecastPresetQuery } from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { forecastFilters } from "@/app/_lib/cash-forecast";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { createAction, deleteAction } from "./actions";

export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("forecastPresets"))("title") }; }
export default async function Page({ params, searchParams }: { params: Promise<{companyId:string}>; searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const { company, actor } = await loadCompany(params, "ledger.read");
  if (!can(company, "sales.read")) notFound();
  const t = await getTranslations("forecastPresets"), forecast = await getTranslations("cashForecast"), errors = await getTranslations("errors");
  const base = `/c/${company.id}/previsions-tresorerie`, manage = can(company, "budget.manage");
  let filters;
  try { filters = forecastFilters(await searchParams, todayIso()); }
  catch (e) { if (!(e instanceof AppError)) throw e; return <section className="space-y-4"><h1 className="text-2xl font-semibold">{t("title")}</h1><p role="alert">{errors("reports.forecastDate")}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}/configurations`}>{forecast("reset")}</Link></section>; }
  const presets = await listForecastPresets(actor), options = (values: readonly number[]) => values.map(n => ({value: String(n), label: String(n)}));
  return <section className="min-w-0 space-y-6 break-words">
    <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-2 max-w-3xl text-sm">{t("intro")}</p></div>
    <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}?${forecastPresetQuery(filters,filters.asOf)}${filters.page>1?`&page=${filters.page}`:""}`}>{t("back")}</Link>
    <p className="text-sm">{t("reference", {date: filters.asOf})}</p>
    {manage && presets.length < MAX_FORECAST_PRESETS ? <section className="max-w-xl rounded-lg border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="new-forecast-preset">
      <h2 id="new-forecast-preset" className="mb-4 text-lg font-semibold">{t("create")}</h2>
      <ActionForm action={createAction.bind(null,company.id,filters.asOf)} label={t("save")} variant="primary">
        <Field name="name" label={t("name")} autoComplete="off" hint={t("nameHint")}/>
        <SelectField name="days" label={forecast("horizon")} options={options(FORECAST_HORIZONS)} defaultValue={String(filters.days)}/>
        <SelectField name="receiptDelay" label={forecast("receiptDelay")} options={options(FORECAST_DELAYS)} defaultValue={String(filters.receiptDelay)}/>
        <SelectField name="paymentDelay" label={forecast("paymentDelay")} options={options(FORECAST_DELAYS)} defaultValue={String(filters.paymentDelay)}/>
      </ActionForm>
    </section> : null}
    {presets.length >= MAX_FORECAST_PRESETS && <p role="status">{t("limit")}</p>}
    <section aria-labelledby="forecast-presets-list" className="space-y-3"><h2 id="forecast-presets-list" className="text-lg font-semibold">{t("list",{count:presets.length,max:MAX_FORECAST_PRESETS})}</h2>
      {presets.length===0 ? <p>{t("empty")}</p> : <ul className="grid gap-4 md:grid-cols-2">{presets.map(p=><li key={p.id} className="min-w-0 rounded-lg border border-stone-300 p-4 dark:border-stone-700">
        <h3 className="font-semibold">{p.name}</h3><p className="my-2 text-sm">{t("summary",{days:p.days,receipt:p.receiptDelay,payment:p.paymentDelay})}</p>
        <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}?${forecastPresetQuery(p,filters.asOf)}`}>{t("apply",{name:p.name})}</Link>
        {manage && <details className="mt-2 text-sm"><summary className={`inline-flex min-h-11 cursor-pointer items-center underline ${FOCUS}`}>{t("delete",{name:p.name})}</summary>
          <ActionForm action={deleteAction.bind(null,company.id,p.id)} label={t("deleteButton")} savedMessage={t("deleted")}>
            <label className="flex min-h-11 items-start gap-2 py-2"><input className={`mt-1 h-5 w-5 shrink-0 ${FOCUS}`} type="checkbox" name="confirmed" value="yes" required/><span>{t("confirm",{name:p.name})}</span></label>
          </ActionForm>
        </details>}
      </li>)}</ul>}
    </section>
    <p className="max-w-3xl text-sm text-stone-600 dark:text-stone-400">{t("limits")}</p>
  </section>;
}
