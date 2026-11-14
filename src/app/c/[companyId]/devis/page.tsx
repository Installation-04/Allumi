import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listEstimates, ESTIMATE_STATUSES } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../_lib";
export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read");
  const search = await searchParams;
  if (["q", "statut", "page"].some(k => Array.isArray(search[k]))) notFound();
  const q = (search.q as string | undefined) ?? "", status = (search.statut as string | undefined) ?? "", pageText = (search.page as string | undefined) ?? "1";
  if (q.length > 120 || /[\u0000-\u001f\u007f]/.test(q) || status && ![...ESTIMATE_STATUSES, "EXPIRED"].includes(status) || !/^[1-9]\d{0,3}$/.test(pageText) || Number(pageText) > 1000) notFound();
  const result = await listEstimates(actor, { q, status, page: Number(pageText) });
  const t = await getTranslations("estimates"), s = await getTranslations("sales");
  const base = `/c/${company.id}/devis`;
  const pageLink = (page: number) => `${base}?${new URLSearchParams({ q, statut: status, page: String(page) })}`;
  const control = "mt-1 block min-h-11 w-full min-w-0 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900";
  return <section className="min-w-0 space-y-5 [overflow-wrap:anywhere]"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{t("title")}</h1>{can(company, "sales.manage") && (["contact.read", "ledger.read", "taxes.read"] as const).every(a => can(company, a)) && <Link className="inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-white" href={`${base}/nouveau`}>{t("new")}</Link>}</div><p>{t("intro")}</p><form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><label>{t("search")}<input className={control} name="q" defaultValue={q} maxLength={120} /></label><label>{t("status")}<select className={control} name="statut" defaultValue={status}><option value="">{t("all")}</option>{([...ESTIMATE_STATUSES, "EXPIRED"] as const).map(v => <option key={v} value={v}>{t(`statuses.${v}`)}</option>)}</select></label><button className="min-h-11 self-end rounded border px-4">{s("search")}</button></form>{!result.estimates.length && <p>{t("empty")}</p>}<ul className="grid min-w-0 gap-3 lg:grid-cols-2">{result.estimates.map(d => <li key={d.id} className="min-w-0"><Link className="block space-y-2 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900" href={`${base}/${d.id}`}><h2 className="font-semibold text-brand-700 dark:text-brand-500">{d.number ?? d.reference ?? t("statuses.DRAFT")}</h2><p>{d.customer ?? t("restrictedCustomer")}</p><p className="text-sm">{t(`statuses.${d.expired ? "EXPIRED" : d.status}`)} · {d.issueDate}</p><p className="text-sm">{t("validUntil")}: {d.validUntil}</p><p className="text-xl font-semibold tabular-nums">{formatMoney(d.totalCents, locale)}</p></Link></li>)}</ul><nav className="flex flex-wrap gap-4" aria-label={t("pagination")}>{result.page > 1 && <Link className="inline-flex min-h-11 items-center underline" href={pageLink(result.page - 1)}>{t("previous")}</Link>}{result.hasMore && <Link className="inline-flex min-h-11 items-center underline" href={pageLink(result.page + 1)}>{t("next")}</Link>}</nav></section>;
}
