import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { loadCompany } from "../_lib";
import { can } from "@/modules/companies";
import { listItems, getTaxConfiguration } from "@/modules/taxes";

export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ q?: string; archived?: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const search = await searchParams;
  const q = typeof search.q === "string" ? search.q.slice(0, 100) : "";
  const { items, truncated } = await listItems(actor, q, search.archived === "1");
  const { codes } = await getTaxConfiguration(actor);
  const t = await getTranslations("catalog");
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{t("items")}</h1>{can(company.role, "catalog.manage") && <Link className="inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-white" href={`/c/${company.id}/catalogue/nouveau`}>{t("newItem")}</Link>}</div><p>{t("itemIntro")}</p>
    <form className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 basis-full sm:basis-auto">{t("search")}<input name="q" maxLength={100} defaultValue={q} className="mt-1 block min-h-11 w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900" /></label><label className="inline-flex min-h-11 items-center gap-2"><input name="archived" type="checkbox" value="1" defaultChecked={search.archived === "1"} />{t("includeArchived")}</label><button className="min-h-11 rounded border px-4">{t("search")}</button></form>
    {truncated && <p role="status">{t("truncated")}</p>}{items.length === 0 && <p>{t("emptyItems")}</p>}
    <ul className="grid gap-3 lg:grid-cols-2">{items.map((item) => <li key={item.id}><Link className="block rounded-lg border border-stone-200 bg-white p-5 hover:border-brand-700 dark:border-stone-800 dark:bg-stone-900" href={`/c/${company.id}/catalogue/${item.id}`}><h2 className="font-semibold text-brand-700 dark:text-brand-500">{item.name}</h2><p>{item.code ?? "—"} · {t(item.isActive ? "active" : "archived")}</p><p className="mt-2 tabular-nums">{locale === "en" ? item.unitPrice : item.unitPrice.replace(".", ",")} CAD</p><p className="text-sm text-stone-600 dark:text-stone-400">{codes.find((code) => code.id === item.defaultTaxCodeId)?.code ?? t("noTaxCode")}</p></Link></li>)}</ul>
  </section>;
}
