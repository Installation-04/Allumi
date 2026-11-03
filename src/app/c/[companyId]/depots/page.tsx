import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listDeposits } from "@/modules/payments";
import { formatMoney } from "@/modules/ledger";
import { searchText } from "@/app/_lib/search-params";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../_lib";
export async function generateMetadata() {
  return { title: (await getTranslations("deposits"))("title") };
}
export default async function DepositsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, actor, locale } = await loadCompany(params, "bank.read");
  const query = await searchParams;
  const [result, t] = await Promise.all([
    listDeposits(actor, Number(searchText(query.page))),
    getTranslations("deposits"),
  ]);
  const base = `/c/${company.id}/depots`;
  const link = `inline-flex min-h-11 items-center rounded px-2 text-sm underline ${FOCUS}`;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {can(company, "bank.manage") ? (
          <Link
            href={`${base}/nouveau`}
            className={`inline-flex min-h-11 items-center rounded bg-brand-700 px-4 text-sm text-white ${FOCUS}`}
          >
            {t("new")}
          </Link>
        ) : null}
      </div>
      <p className="max-w-3xl text-sm">{t("intro")}</p>
      {!result.deposits.length ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {result.deposits.map((d) => (
            <li
              key={d.id}
              className="min-w-0 space-y-2 break-words rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  className={`${link} font-medium`}
                  href={`${base}/${d.id}`}
                >
                  {d.number}
                </Link>
                <span className="text-sm">
                  {t(d.status === "POSTED" ? "posted" : "void")}
                </span>
              </div>
              <p>
                {d.date} · {d.account.code} · {accountName(d.account, locale)}
              </p>
              <p className="font-semibold tabular-nums">
                {formatMoney(d.totalCents, locale)}
              </p>
              <p className="text-sm">
                {t("itemCount", { count: d.count })}
                {d.reference ? ` · ${d.reference}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <nav
        className="flex flex-wrap items-center gap-3"
        aria-label={t("pages")}
      >
        <p className="text-sm">
          {t("page", { page: result.page, pages: result.pageCount })}
        </p>
        {result.page > 1 ? (
          <Link className={link} href={`${base}?page=${result.page - 1}`}>
            {t("previous")}
          </Link>
        ) : null}
        {result.page < result.pageCount ? (
          <Link className={link} href={`${base}?page=${result.page + 1}`}>
            {t("next")}
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
