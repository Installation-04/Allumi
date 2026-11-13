import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/modules/ledger";
import { searchCompany, SEARCH_KINDS, SEARCH_STATUSES, hasSearchCriteria } from "@/modules/search";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../_lib";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("companySearch"))("title") }; }

export default async function Page({ params, searchParams }: {
  params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, locale } = await loadCompany(params, "company.read"), query = await searchParams;
  const t = await getTranslations("companySearch");
  const result = await searchCompany(actor, query, locale).catch((error: unknown) => { if (error instanceof RangeError) notFound(); throw error; });
  const { filters } = result, path = `/c/${actor.companyId}/recherche`;
  const advancedCount = [filters.kind, filters.status, filters.from, filters.to, filters.amountCents !== null ? "amount" : null].filter(Boolean).length;
  const filterKey = JSON.stringify([filters.query, filters.kind, filters.status, filters.from, filters.to, filters.amountCents?.toString()]);
  const control = `min-h-11 min-w-0 w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const pagination = (page: number) => {
    const values = new URLSearchParams();
    for (const key of ["q", "type", "statut", "du", "au", "montant"]) if (typeof query[key] === "string" && query[key]) values.set(key, query[key]);
    values.set("page", String(page)); return `${path}?${values}`;
  };
  return <section className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
    <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
    <form method="get" aria-label={t("filters")} className="grid min-w-0 gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-stone-700 dark:bg-stone-900">
      <label className="min-w-0 sm:col-span-2 lg:col-span-3">{t("query")}<input name="q" maxLength={120} defaultValue={filters.query} placeholder={t("placeholder")} className={control} /></label>
      <details key={filterKey} open={!hasSearchCriteria(filters)} className="min-w-0 sm:col-span-2 lg:col-span-3">
        <summary className={`min-h-11 cursor-pointer rounded py-2 ${FOCUS}`}>{t("advanced")}{advancedCount > 0 ? ` · ${advancedCount}` : ""}</summary>
        <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="min-w-0"><label htmlFor="company-search-type">{t("type")}</label><select id="company-search-type" name="type" defaultValue={filters.kind ?? ""} className={control}><option value="">{t("all")}</option>{SEARCH_KINDS.map(kind => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}</select></div>
      <div className="min-w-0"><label htmlFor="company-search-status">{t("status")}</label><select id="company-search-status" name="statut" defaultValue={filters.status ?? ""} className={control}><option value="">{t("all")}</option>{SEARCH_STATUSES.map(status => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}</select></div>
      <label className="min-w-0">{t("amount")}<input name="montant" inputMode="decimal" maxLength={32} defaultValue={filters.amountCents === null ? "" : formatMoney(filters.amountCents, locale)} className={control} /></label>
      <label className="min-w-0">{t("from")}<input name="du" type="date" defaultValue={filters.from ?? ""} className={control} /></label>
      <label className="min-w-0">{t("to")}<input name="au" type="date" defaultValue={filters.to ?? ""} className={control} /></label>
        </div>
      </details>
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-3"><button className={`min-h-11 rounded bg-brand-700 px-5 text-white hover:bg-brand-800 ${FOCUS}`} type="submit">{t("submit")}</button><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={path}>{t("reset")}</Link></div>
    </form>
    <p className="text-sm text-stone-600 dark:text-stone-400">{t("scope")}</p>
    {!hasSearchCriteria(filters) ? <p>{t("emptyQuery")}</p> : <>
      <p role="status">{result.rows.length ? t("pageResults", { count: result.rows.length, page: filters.page }) : t("noResults")}</p>
      <ul aria-label={t("results")} className="min-w-0 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-700 dark:border-stone-700 dark:bg-stone-900">
        {result.rows.map(row => <li key={`${row.kind}:${row.id}`} className="min-w-0 p-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 max-w-full"><p className="text-xs text-stone-600 dark:text-stone-400">{t(`kinds.${row.kind}`)} · {t(`statuses.${row.status}`)}</p><Link className={`inline-flex min-h-11 max-w-full items-center rounded text-brand-700 underline dark:text-brand-500 ${FOCUS}`} href={row.href}>{row.reference ?? row.name ?? (row.status === "DRAFT" ? t("unnumbered") : t(`kinds.${row.kind}`))}</Link>{row.reference && row.name && <p className="text-sm">{row.name}</p>}</div>
            <div className="min-w-0 text-right text-sm">{row.amountCents !== null && <p className="font-semibold tabular-nums">{formatMoney(row.amountCents, locale)}</p>}{row.date && <time dateTime={row.date}>{row.date}</time>}</div>
          </div>
        </li>)}
      </ul>
      <nav aria-label={t("pagination")} className="flex flex-wrap gap-4">{filters.page > 1 && <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={pagination(filters.page - 1)}>{t("previous")}</Link>}{result.hasMore && <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={pagination(filters.page + 1)}>{t("next")}</Link>}</nav>
      {result.capped && <p>{t("capped")}</p>}
    </>}
  </section>;
}
