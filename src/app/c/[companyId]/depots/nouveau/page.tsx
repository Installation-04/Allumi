import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import {
  listDepositAccounts,
  listPendingDepositReceipts,
} from "@/modules/payments";
import { todayIso } from "@/modules/ledger";
import { notFound } from "next/navigation";
import { searchText } from "@/app/_lib/search-params";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { recordDepositAction } from "../actions";
import { DepositForm } from "./deposit-form";
export async function generateMetadata() {
  return { title: (await getTranslations("deposits"))("new") };
}
export default async function NewDepositPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, actor, locale } = await loadCompany(params, "bank.read");
  if (!can(company, "bank.manage")) notFound();
  const query = await searchParams;
  const q = searchText(query.q, 100);
  const page = Number(searchText(query.page));
  const [result, accounts, t] = await Promise.all([
    listPendingDepositReceipts(actor, page, q),
    listDepositAccounts(actor),
    getTranslations("deposits"),
  ]);
  const base = `/c/${company.id}/depots`;
  const link = `inline-flex min-h-11 items-center rounded px-2 text-sm underline ${FOCUS}`;
  const url = (page: number) =>
    `${base}/nouveau?${new URLSearchParams({ page: String(page), ...(q ? { q } : {}) })}`;
  return (
    <section className="max-w-4xl space-y-5">
      <Link href={base} className={link}>
        {t("back")}
      </Link>
      <h1 className="break-words text-2xl font-semibold">{t("new")}</h1>
      <p className="text-sm">{t("intro")}</p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <label className="mb-1 block text-sm" htmlFor="receipt-query">
            {t("search")}
          </label>
          <input
            id="receipt-query"
            name="q"
            defaultValue={q}
            maxLength={100}
            className={`min-h-11 max-w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}
          />
        </div>
        <button className={`min-h-11 rounded border px-3 text-sm ${FOCUS}`}>
          {t("filter")}
        </button>
      </form>
      <p className="text-sm">{t("pendingCount", { count: result.total })}</p>
      {result.receipts.length && accounts.length ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <DepositForm
            key={`${result.page}:${q}`}
            action={recordDepositAction.bind(null, company.id)}
            date={todayIso()}
            receipts={result.receipts.map((p) => ({
              ...p,
              amountCents: String(p.amountCents),
            }))}
            accounts={accounts.map((a) => ({
              value: a.id,
              label: `${a.code} · ${accountName(a, locale)}`,
            }))}
          />
        </div>
      ) : (
        <p>{t(accounts.length ? "emptyPending" : "noAccounts")}</p>
      )}
      {result.pageCount > 1 ? (
        <nav
          aria-label={t("pages")}
          className="flex flex-wrap items-center gap-3"
        >
          <p>{t("page", { page: result.page, pages: result.pageCount })}</p>
          {result.page > 1 ? (
            <Link className={link} href={url(result.page - 1)}>
              {t("previous")}
            </Link>
          ) : null}
          {result.page < result.pageCount ? (
            <Link className={link} href={url(result.page + 1)}>
              {t("next")}
            </Link>
          ) : null}
          <p className="text-sm">{t("pageSelection")}</p>
        </nav>
      ) : null}
    </section>
  );
}
