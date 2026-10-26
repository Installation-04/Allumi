import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { can } from "@/modules/companies";
import { formatMoney, isValidIsoDate, listAccounts, listEntries } from "@/modules/ledger";
import { accountName, loadCompany } from "../_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("journal"))("title") };
}

type Search = { du?: string; au?: string; compte?: string; page?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JournalPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Search> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const search = await searchParams;
  const from = search.du && isValidIsoDate(search.du) ? search.du : undefined;
  const to = search.au && isValidIsoDate(search.au) ? search.au : undefined;
  const accountId = search.compte && UUID.test(search.compte) ? search.compte : undefined;
  const requestedPage = Number.parseInt(search.page ?? "1", 10);

  const [t, ts] = [await getTranslations("journal"), await getTranslations("enums.source")];
  const [accounts, result] = await Promise.all([
    listAccounts(actor, { includeInactive: true }),
    listEntries(actor, { from, to, accountId, page: Number.isFinite(requestedPage) ? requestedPage : 1 }),
  ]);
  const base = `/c/${company.id}/journal`;
  const link = (page: number) => {
    const query = new URLSearchParams();
    if (from) query.set("du", from);
    if (to) query.set("au", to);
    if (accountId) query.set("compte", accountId);
    query.set("page", String(page));
    return `${base}?${query.toString()}`;
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {can(company, "entry.post") ? (
          <Link href={`${base}/nouvelle`} className={`rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 ${FOCUS}`}>
            {t("new")}
          </Link>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("from")}</span>
          <input type="date" name="du" defaultValue={from} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("to")}</span>
          <input type="date" name="au" defaultValue={to} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("account")}</span>
          <select name="compte" defaultValue={accountId ?? ""} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>
            <option value="">{t("allAccounts")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} – {accountName(account, locale)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>
          {t("filter")}
        </button>
      </form>

      <p className="text-sm text-stone-700 dark:text-stone-300">{t("total", { count: result.total })}</p>
      {result.entries.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <caption className="sr-only">{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH_CLASS}>{t("number")}</th>
                <th scope="col" className={TH_CLASS}>{t("date")}</th>
                <th scope="col" className={TH_CLASS}>{t("memo")}</th>
                <th scope="col" className={TH_CLASS}>{t("source")}</th>
                <th scope="col" className={`${TH_CLASS} text-right`}>{t("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={`${TD_CLASS} font-mono`}>
                    <Link href={`${base}/${entry.id}`} className={`rounded-sm underline ${FOCUS}`}>
                      {entry.numberLabel}
                    </Link>
                  </td>
                  <td className={`${TD_CLASS} tabular-nums`}>{entry.date}</td>
                  <td className={TD_CLASS}>{entry.memo}</td>
                  <td className={TD_CLASS}>
                    {ts(entry.source)}
                    {entry.reversedByEntryId ? <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs dark:bg-stone-800">{t("reversed")}</span> : null}
                  </td>
                  <td className={`${TD_CLASS} text-right tabular-nums`}>{formatMoney(entry.totalCents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.pageCount > 1 ? (
        <nav className="flex items-center gap-4 text-sm" aria-label={t("page", { page: result.page, count: result.pageCount })}>
          {result.page > 1 ? (
            <Link href={link(result.page - 1)} className={`rounded-sm underline ${FOCUS}`}>
              {t("previous")}
            </Link>
          ) : null}
          <span>{t("page", { page: result.page, count: result.pageCount })}</span>
          {result.page < result.pageCount ? (
            <Link href={link(result.page + 1)} className={`rounded-sm underline ${FOCUS}`}>
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
