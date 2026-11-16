import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadCompany } from "../../_lib";
import { todayIso } from "@/modules/ledger";
import { getOfficialCodeComparison, officialScope, PROVINCES, COVERAGE_FROM, CRA_PAGE, RQ_URL, ratePercentage } from "@/modules/taxes";
import { AppError } from "@/platform/errors";
import { FOCUS } from "@/app/_components/focus";

export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("officialComparison"))("title") }; }

export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { actor, company, locale } = await loadCompany(params, "taxes.read"), query = await searchParams;
  const t = await getTranslations("officialComparison"), official = await getTranslations("officialTaxes"), catalog = await getTranslations("catalog");
  for (const key of ["province", "date", "code", "charger"]) if (Array.isArray(query[key])) notFound();
  const province = (query.province as string | undefined) ?? "QC", date = (query.date as string | undefined) ?? todayIso(), code = ((query.code as string | undefined) ?? "").trim();
  try { officialScope(province, date, todayIso()); } catch { notFound(); }
  if ((code && !/^[A-Z0-9][A-Z0-9+-]{0,23}$/.test(code)) || (query.charger !== undefined && query.charger !== "1") || (query.charger === "1" && !code)) notFound();
  let result: Awaited<ReturnType<typeof getOfficialCodeComparison>> | null = null, error: string | null = null;
  if (query.charger === "1") try { result = await getOfficialCodeComparison(actor, province, date, code); } catch (e) {
    if (e instanceof AppError && ["officialTaxes.unavailable", "officialTaxes.schema"].includes(e.key)) error = e.key;
    else if (e instanceof AppError && ["catalog.notFound", "officialTaxes.invalid"].includes(e.key)) notFound();
    else throw e;
  }
  const panel = "min-w-0 space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900";
  const control = `min-h-11 min-w-0 w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const percent = (rate: string) => { const value = ratePercentage(rate); return `${locale === "en" ? value : value.replace(".", ",")} %`; };
  return <section className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
    <Link href={`/c/${company.id}/sources-fiscales`} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{official("title")}</Link>
    <h1 className="text-2xl font-semibold">{t("title")}</h1><p>{t("intro")}</p>
    <form method="get" aria-label={t("compare")} className={`${panel} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
      <input type="hidden" name="charger" value="1" />
      <label className="min-w-0">{official("code")}<input className={control} name="code" required maxLength={24} defaultValue={code} autoCapitalize="characters" /></label>
      <div><label htmlFor="compare-province">{official("province")}</label><select className={control} id="compare-province" name="province" defaultValue={province}>{PROVINCES.map(value => <option key={value} value={value}>{official(`provinces.${value}`)}</option>)}</select></div>
      <label className="min-w-0">{official("date")}<input className={control} type="date" name="date" min={COVERAGE_FROM} max={todayIso()} required defaultValue={date} /></label>
      <button className={`min-h-11 self-end rounded bg-brand-700 px-4 text-white ${FOCUS}`} type="submit">{t("compare")}</button>
    </form>
    <p className="text-sm text-stone-600 dark:text-stone-400">{t("limits")}</p>
    {error && <p role="alert">{(await getTranslations("errors"))(error as "officialTaxes.unavailable")}</p>}
    {result && <>
      <h2 className="text-xl font-semibold">{t("scope", { code: result.comparison.code, province: official(`provinces.${result.preview.province}`), date: result.preview.date })}</h2>
      <p role="status" className={panel}>{t(`statuses.${result.comparison.status}`)}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <article className={panel} aria-label={t("local")}><h3 className="text-lg font-semibold">{t("local")}</h3>
          <p>{locale === "en" ? result.comparison.nameEn : result.comparison.nameFr}</p>
          <p>{catalog(`treatments.${result.comparison.treatment as "STANDARD"}`)} · {catalog(result.comparison.isActive ? "active" : "archived")}</p>
          <ul className="space-y-4">{result.comparison.components.map(part => <li key={part.code} className="border-t border-stone-200 pt-3 dark:border-stone-700">
            <p className="font-semibold">{part.code} — {locale === "en" ? part.nameEn : part.nameFr}</p>
            <p>{part.rate === null ? t("missing") : percent(part.rate)} · {catalog(part.isActive ? "active" : "archived")}</p>
          </li>)}</ul>{!result.comparison.components.length && <p>{t("noComponents")}</p>}
        </article>
        <article className={panel} aria-label={t("official")}><h3 className="text-lg font-semibold">{t("official")}</h3>
          <ul className="space-y-4">{result.comparison.expected.map(part => {
            const source = result!.preview.sources.find(value => value.id === part.provider)!;
            return <li key={part.provider} className="space-y-2 border-t border-stone-200 pt-3 dark:border-stone-700"><p className="font-semibold">{official(`providers.${part.provider}`)} · {percent(part.rate)}</p>
              <p className="text-sm">{official("collected", { date: source.collectedAt.slice(0, 19).replace("T", " ") + " UTC" })}</p>
              <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={part.provider === "CRA_GST_HST" ? CRA_PAGE : RQ_URL}>{official("officialSource")}</Link>
              <details><summary className={`min-h-11 cursor-pointer py-2 ${FOCUS}`}>{official("history")}</summary><ul>{source.rates.map(rate => <li key={rate.from}>{rate.from} → {rate.to ?? official("ongoing")} · {percent(rate.rate)}</li>)}</ul><p className="break-all font-mono text-xs">SHA-256 : {source.sha256}</p></details>
            </li>;
          })}</ul>
        </article>
      </div>
      <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/taxes`}>{official("back")}</Link>
    </>}
  </section>;
}
