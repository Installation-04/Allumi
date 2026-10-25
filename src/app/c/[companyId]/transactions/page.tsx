import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { formatMoney } from "@/modules/ledger";
import { listBankAccounts, listBankTransactions, TRANSACTION_STATUSES } from "@/modules/banking";
import { listConnections } from "@/modules/integrations";
import { searchText } from "@/app/_lib/search-params";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../_lib";
import { validId } from "../factures/editor";
import { setStatusAction } from "./actions";

export async function generateMetadata() { return { title: (await getTranslations("transactions"))("title") }; }

const count = (value: string | undefined) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 100_000 ? number : null;
};

export default async function TransactionsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params);
  const query = await searchParams;
  const rawAccount = searchText(query.account);
  const accountId = rawAccount && validId(rawAccount) ? rawAccount : undefined;
  const rawConnection = searchText(query.connection);
  const connectionId = rawConnection && validId(rawConnection) ? rawConnection : undefined;
  const status = TRANSACTION_STATUSES.find((value) => value === searchText(query.status));
  const q = searchText(query.q, 100);
  const rawPage = Number(searchText(query.page));
  const [result, accounts, connections] = await Promise.all([
    listBankTransactions(actor, { accountId, connectionId, status, q, page: Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1 }),
    listBankAccounts(actor),
    listConnections(actor),
  ]);
  const t = await getTranslations("transactions");
  const base = `/c/${company.id}/transactions`;
  const url = (change: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { account: accountId, connection: connectionId, status, q, ...change };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
  const money = (cents: bigint, currency: string) => `${formatMoney(cents, locale)}${currency === "CAD" ? "" : ` ${currency}`}`;
  const link = `inline-flex min-h-11 items-center rounded px-3 text-sm underline ${FOCUS}`;
  const control = `min-h-11 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const canManage = can(company.role, "bank.manage");
  const imported = count(searchText(query.imported));
  const duplicates = count(searchText(query.duplicates)) ?? 0;
  const skipped = count(searchText(query.skipped)) ?? 0;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
        {canManage ? <Link href={`${base}/importer`} className={`inline-flex min-h-11 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 ${FOCUS}`}>{t("import")}</Link> : null}
      </div>
      {imported !== null ? (
        <div role="status" className="space-y-1 rounded border border-brand-700 p-3 text-sm">
          <p>{t("importDone", { imported })}</p>
          {duplicates ? <p>{t("importDuplicates", { count: duplicates })}</p> : null}
          {skipped ? <p>{t("importSkipped", { count: skipped })}</p> : null}
        </div>
      ) : null}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 text-sm"><span className="mb-1 block">{t("account")}</span>
          <select name="account" defaultValue={accountId ?? ""} className={control}>
            <option value="">{t("allAccounts")}</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {accountName(account, locale)}</option>)}
          </select></label>
        {connections.length > 0 ? (
          <label className="min-w-0 text-sm"><span className="mb-1 block">{t("connection")}</span>
            <select name="connection" defaultValue={connectionId ?? ""} className={control}>
              <option value="">{t("allConnections")}</option>
              {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
            </select></label>
        ) : null}
        <label className="text-sm"><span className="mb-1 block">{t("status")}</span>
          <select name="status" defaultValue={status ?? ""} className={control}>
            <option value="">{t("allStatuses")}</option>
            {TRANSACTION_STATUSES.map((value) => <option key={value} value={value}>{t(`statuses.${value}`)}</option>)}
          </select></label>
        <label className="min-w-0 text-sm"><span className="mb-1 block">{t("search")}</span>
          <input name="q" defaultValue={q ?? ""} maxLength={100} placeholder={t("searchHint")} className={`${control} w-56 max-w-full`} /></label>
        <button className={`min-h-11 rounded border border-stone-300 px-4 text-sm dark:border-stone-700 ${FOCUS}`}>{t("apply")}</button>
      </form>
      <p className="text-sm text-stone-600 dark:text-stone-400" role="status">{t("count", { count: result.total })}</p>
      {result.transactions.length === 0 ? (
        <div className="border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-700 dark:bg-stone-900">
          <h2 className="font-semibold">{t("empty")}</h2>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            {t("emptyHint")}{" "}
            {canManage ? <Link href={`${base}/importer`} className={`underline ${FOCUS}`}>{t("import")}</Link> : null}{canManage ? " · " : null}
            <Link href={`/c/${company.id}/integrations`} className={`underline ${FOCUS}`}>{t("goToIntegrations")}</Link>
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {result.transactions.map((transaction) => {
            const source = transaction.source;
            return (
              <li key={transaction.id} className="space-y-1 rounded border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold break-words">{transaction.description}</h2>
                  <span className="font-semibold tabular-nums">{money(transaction.amountCents, transaction.currency)}</span>
                </div>
                <p className="text-sm break-words">
                  {transaction.date}{source.kind === "service" ? ` · ${t(`kinds.${source.type as "OTHER"}`)}` : ""} · {t(`statuses.${transaction.status}`)} · {transaction.accountCode} · {accountName({ nameFr: transaction.accountNameFr, nameEn: transaction.accountNameEn }, locale)}
                </p>
                {transaction.payee && transaction.payee !== transaction.description ? <p className="text-sm break-words">{transaction.payee}</p> : null}
                {source.kind === "file" ? <p className="text-sm text-stone-600 dark:text-stone-400 break-words">{t("fromFile", { file: source.fileName })}</p> : null}
                {source.kind === "service" ? <p className="text-sm text-stone-600 dark:text-stone-400 break-words">{t("fromService", { label: source.label })}{source.sandbox ? ` (${t("test")})` : ""}</p> : null}
                {source.kind === "service" && source.grossCents !== null && source.feeCents !== null ? <p className="text-sm tabular-nums text-stone-600 dark:text-stone-400">{t("gross")} {money(source.grossCents, transaction.currency)} · {t("fee")} {money(source.feeCents, transaction.currency)}</p> : null}
                {source.kind === "service" && source.reference ? <p className="text-sm break-words">{t("reference")} : {source.reference}</p> : null}
                {source.kind === "service" && source.flagged ? <p role="note" className="text-sm text-amber-700 dark:text-amber-400">{t("flagged")}</p> : null}
                {canManage && transaction.status === "UNMATCHED" ? <ActionForm action={setStatusAction.bind(null, company.id, transaction.id, "EXCLUDED")} label={t("setAside")} ariaLabel={t("setAsideNamed", { description: transaction.description })} /> : null}
                {canManage && transaction.status === "EXCLUDED" ? <ActionForm action={setStatusAction.bind(null, company.id, transaction.id, "UNMATCHED")} label={t("restore")} ariaLabel={t("restoreNamed", { description: transaction.description })} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {result.pageCount > 1 ? (
        <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">
          {result.page > 1 ? <Link href={url({ page: String(result.page - 1) })} className={link}>{t("previous")}</Link> : null}
          <span className="text-sm">{t("page", { page: result.page, count: result.pageCount })}</span>
          {result.page < result.pageCount ? <Link href={url({ page: String(result.page + 1) })} className={link}>{t("next")}</Link> : null}
        </nav>
      ) : null}
    </section>
  );
}
