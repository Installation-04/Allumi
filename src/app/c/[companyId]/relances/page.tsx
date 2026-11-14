import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listInvoiceReminders } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../_lib";

export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read"), query = await searchParams;
  if (!can(company, "ledger.read") || ["q", "page"].some(k => Array.isArray(query[k]))) notFound();
  const q = query.q as string ?? "", page = query.page as string ?? "1";
  if (q.length > 120 || /[\x00-\x1f\x7f]/.test(q) || !/^[1-9]\d{0,3}$/.test(page) || Number(page) > 1000) notFound();
  const result = await listInvoiceReminders(actor, { q, page: Number(page) }), t = await getTranslations("reminders"), base = `/c/${company.id}/relances`;
  const pagination = (n: number) => `${base}?${new URLSearchParams({ q, page: String(n) })}`;
  return <section className="space-y-5 [overflow-wrap:anywhere]">
    <h1 className="text-2xl font-semibold">{t("title")}</h1><p>{t("intro")}</p><p className="text-sm">{t("checked", { date: result.asOf })}</p>
    <form className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1">{t("search")}<input name="q" maxLength={120} defaultValue={q} className="mt-1 block min-h-11 w-full rounded border bg-white px-3 dark:bg-stone-900" /></label><button className="min-h-11 rounded border px-4">{t("filter")}</button></form>
    {!result.rows.length && <p role="status">{t("empty")}</p>}
    <ul className="grid min-w-0 gap-3 lg:grid-cols-2">{result.rows.map(row => <li key={row.id} className="min-w-0 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><h2 className="font-semibold">{row.number} · {row.customer}</h2><p>{t("due")}: {row.dueDate}</p><p className="text-lg font-semibold tabular-nums">{t("outstanding")}: {formatMoney(row.openCents, locale)}</p><p className="text-sm">{row.lastReminder ? t("last", { date: row.lastReminder.replace("T", " ").slice(0, 16) + " UTC" }) : t("never")}</p><Link className="inline-flex min-h-11 items-center font-medium text-brand-700 underline dark:text-brand-500" href={`${base}/${row.id}`}>{t("prepare")}</Link></li>)}</ul>
    <nav className="flex flex-wrap gap-4" aria-label={t("pagination")}>{result.page > 1 && <Link className="inline-flex min-h-11 items-center underline" href={pagination(result.page - 1)}>{t("previous")}</Link>}{result.hasMore && <Link className="inline-flex min-h-11 items-center underline" href={pagination(result.page + 1)}>{t("next")}</Link>}</nav>
  </section>;
}
