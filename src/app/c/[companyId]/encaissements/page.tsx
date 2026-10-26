import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/modules/ledger";
import { listReceipts } from "@/modules/payments";
import { searchText } from "@/app/_lib/search-params";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../_lib";

export async function generateMetadata() { return { title: (await getTranslations("payments"))("title") }; }

export default async function PaymentsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read");
  const query = await searchParams;
  const rawPage = Number(searchText(query.page));
  const result = await listReceipts(actor, Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1);
  const t = await getTranslations("payments");
  const base = `/c/${company.id}/encaissements`;
  const link = `inline-flex min-h-11 items-center rounded px-3 text-sm underline ${FOCUS}`;
  return (
    <section className="space-y-5">
      <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
      <p className="text-sm text-stone-600 dark:text-stone-400" role="status">{t("count", { count: result.total })}</p>
      {result.receipts.length === 0 ? (
        <div className="border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-700 dark:bg-stone-900"><h2 className="font-semibold">{t("empty")}</h2><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("emptyHint")}</p></div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {result.receipts.map((receipt) => (
            <li key={receipt.id}>
              <Link href={`${base}/${receipt.id}`} className={`block space-y-1 rounded border border-stone-300 bg-white p-5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>
                <h2 className="font-semibold">{receipt.number}</h2>
                <p className="break-words">{receipt.customer}</p>
                <p className="tabular-nums">{formatMoney(receipt.amountCents, locale)} · {receipt.date}</p>
                <p className="text-sm">{t(`statuses.${receipt.status}`)} · {t(`methods.${receipt.method}`)}{receipt.invoices.length ? ` · ${receipt.invoices.map((invoice) => invoice.number).join(", ")}` : ""}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.pageCount > 1 && (
        <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">
          {result.page > 1 ? <Link href={`${base}?page=${result.page - 1}`} className={link}>{t("previous")}</Link> : null}
          <span className="text-sm">{t("page", { page: result.page, count: result.pageCount })}</span>
          {result.page < result.pageCount ? <Link href={`${base}?page=${result.page + 1}`} className={link}>{t("next")}</Link> : null}
        </nav>
      )}
    </section>
  );
}
