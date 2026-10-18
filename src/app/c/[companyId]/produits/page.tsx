import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { searchText } from "@/app/_lib/search-params";
import { can } from "@/modules/companies";
import { listItems } from "@/modules/contacts";
import { formatMoney } from "@/modules/ledger";
import { formatDecimal, UNIT_PRICE_SCALE } from "@/modules/taxes";
import { loadCompany } from "../_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("items"))("title") };
}

type Search = { q?: string | string[]; inactifs?: string | string[]; page?: string | string[] };

export default async function ItemsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Search> }) {
  const { company, actor, locale } = await loadCompany(params);
  const search = await searchParams;
  const q = searchText(search.q);
  const includeInactive = searchText(search.inactifs, 1) === "1";
  const pageNumber = Number(searchText(search.page, 6) ?? "1");
  const t = await getTranslations("items");
  const result = await listItems(actor, { search: q, includeInactive, page: Number.isFinite(pageNumber) ? pageNumber : 1 });
  const base = `/c/${company.id}/produits`;
  const query = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = { q, inactifs: includeInactive ? "1" : undefined, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
  // a price with at least two decimals, and more only when it has them
  const price = (micro: bigint | null) => (micro === null ? "—" : micro % 10_000n === 0n ? formatMoney(micro / 10_000n, locale) : formatDecimal(micro, UNIT_PRICE_SCALE, locale, 2));

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {can(company.role, "item.manage") ? (
          <Link href={`${base}/nouveau`} className={`rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 ${FOCUS}`}>
            {t("new")}
          </Link>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("search")}</span>
          <input name="q" defaultValue={q} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </label>
        {includeInactive ? <input type="hidden" name="inactifs" value="1" /> : null}
        <button type="submit" className={`rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>
          {t("apply")}
        </button>
        <Link href={query({ inactifs: includeInactive ? undefined : "1", page: undefined })} className={`rounded-sm text-sm underline ${FOCUS}`}>
          {includeInactive ? t("hideInactive") : t("showInactive")}
        </Link>
      </form>

      {result.items.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <caption className="sr-only">{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH_CLASS}>{t("code")}</th>
                <th scope="col" className={TH_CLASS}>{t("name")}</th>
                <th scope="col" className={`${TH_CLASS} text-right`}>{t("unitPrice")}</th>
                <th scope="col" className={TH_CLASS}>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id}>
                  <td className={`${TD_CLASS} font-mono`}>{item.code ?? "—"}</td>
                  <td className={TD_CLASS}>
                    <Link href={`${base}/${item.id}`} className={`rounded-sm font-medium underline ${FOCUS}`}>
                      {item.name}
                    </Link>
                  </td>
                  <td className={`${TD_CLASS} text-right tabular-nums`}>{price(item.unitPrice)}</td>
                  <td className={TD_CLASS}>{item.isActive ? t("active") : t("inactive")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label={t("pages")} className="flex items-center gap-4 text-sm">
        <span>{t("pageOf", { page: result.page, count: result.pageCount, total: result.total })}</span>
        {result.page > 1 ? (
          <Link href={query({ page: String(result.page - 1) })} className={`rounded-sm underline ${FOCUS}`}>
            {t("previous")}
          </Link>
        ) : null}
        {result.page < result.pageCount ? (
          <Link href={query({ page: String(result.page + 1) })} className={`rounded-sm underline ${FOCUS}`}>
            {t("next")}
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
