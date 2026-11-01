import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listExpenseDrafts } from "@/modules/purchases";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../_lib";
export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const search = await searchParams;
  const q = typeof search.q === "string" ? search.q.slice(0, 100) : "";
  const result = await listExpenseDrafts(actor, q);
  const t = await getTranslations("expenses");
  const base = `/c/${company.id}/depenses`;
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{t("title")}</h1>{can(company, "entry.post") && <Link className="inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-white" href={`${base}/nouvelle`}>{t("new")}</Link>}</div><Link className="inline-flex min-h-11 items-center underline" href={`${base}/validees`}>{t("postedList")}</Link><p>{t("intro")}</p><form className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1">{t("search")}<input className="mt-1 block min-h-11 w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900" name="q" defaultValue={q} maxLength={100} /></label><button className="min-h-11 rounded border px-4">{t("search")}</button></form>{result.truncated && <p>{t("limit")}</p>}{!result.drafts.length && <p>{t("empty")}</p>}<ul className="grid gap-3 lg:grid-cols-2">{result.drafts.map(d => <li key={d.id}><Link className="block space-y-2 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900" href={`${base}/${d.id}`}><h2 className="font-semibold text-brand-700 dark:text-brand-500">{d.supplierReference || t("draft")}</h2><p>{d.supplier}</p><p>{d.documentDate} · {t("draft")}</p><p className="text-xl font-semibold tabular-nums">{formatMoney(d.totalCents, locale)}</p></Link></li>)}</ul></section>;
}
