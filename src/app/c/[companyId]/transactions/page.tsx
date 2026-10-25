import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { formatMoney } from "@/modules/ledger";
import { listConnections, listImportedTransactions } from "@/modules/integrations";
import { searchText } from "@/app/_lib/search-params";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../_lib";
import { validId } from "../factures/editor";
import { setStatusAction } from "../integrations/actions";

export async function generateMetadata() { return { title: (await getTranslations("transactions"))("title") }; }

const STATUSES = ["UNMATCHED", "MATCHED", "EXCLUDED"] as const;

export default async function TransactionsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params);
  const query = await searchParams;
  const rawConnection = searchText(query.connection);
  const connectionId = rawConnection && validId(rawConnection) ? rawConnection : undefined;
  const rawStatus = searchText(query.status);
  const status = STATUSES.find((value) => value === rawStatus);
  const rawPage = Number(searchText(query.page));
  const [result, connections] = await Promise.all([
    listImportedTransactions(actor, { connectionId, status, page: Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1 }),
    listConnections(actor),
  ]);
  const t = await getTranslations("transactions");
  const base = `/c/${company.id}/transactions`;
  const url = (change: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { connection: connectionId, status, ...change };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
  const money = (cents: bigint, currency: string) => `${formatMoney(cents, locale)}${currency === "CAD" ? "" : ` ${currency}`}`;
  const link = `inline-flex min-h-11 items-center rounded px-3 text-sm underline ${FOCUS}`;
  const canManage = can(company.role, "bank.manage");
  return (
    <section className="space-y-5">
      <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 text-sm"><span className="mb-1 block">{t("connection")}</span>
          <select name="connection" defaultValue={connectionId ?? ""} className={`min-h-11 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>
            <option value="">{t("allConnections")}</option>
            {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
          </select></label>
        <label className="text-sm"><span className="mb-1 block">{t("status")}</span>
          <select name="status" defaultValue={status ?? ""} className={`min-h-11 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`statuses.${value}`)}</option>)}
          </select></label>
        <button className={`min-h-11 rounded border border-stone-300 px-4 text-sm dark:border-stone-700 ${FOCUS}`}>{t("apply")}</button>
      </form>
      <p className="text-sm text-stone-600 dark:text-stone-400" role="status">{t("count", { count: result.total })}</p>
      {result.transactions.length === 0 ? (
        <div className="border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-700 dark:bg-stone-900"><h2 className="font-semibold">{t("empty")}</h2><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("emptyHint")} <Link href={`/c/${company.id}/integrations`} className={`underline ${FOCUS}`}>{t("goToIntegrations")}</Link></p></div>
      ) : (
        <ul className="space-y-3">
          {result.transactions.map((transaction) => (
            <li key={transaction.id} className="space-y-1 rounded border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold break-words">{transaction.description}</h2>
                <span className="font-semibold tabular-nums">{money(transaction.amountCents, transaction.currency)}</span>
              </div>
              <p className="text-sm">{transaction.date} · {t(`kinds.${transaction.kind}`)} · {t(`statuses.${transaction.status}`)} · {transaction.connectionLabel}{transaction.sandbox ? ` (${t("test")})` : ""}</p>
              {transaction.grossCents !== null && transaction.feeCents !== null ? <p className="text-sm tabular-nums text-stone-600 dark:text-stone-400">{t("gross")} {money(transaction.grossCents, transaction.currency)} · {t("fee")} {money(transaction.feeCents, transaction.currency)}</p> : null}
              {transaction.reference ? <p className="text-sm break-words">{t("reference")} : {transaction.reference}</p> : null}
              {transaction.flagged ? <p role="note" className="text-sm text-amber-700 dark:text-amber-400">{t("flagged")}</p> : null}
              {canManage && transaction.status === "UNMATCHED" ? <ActionForm action={setStatusAction.bind(null, company.id, transaction.id, "EXCLUDED")} label={t("setAside")} ariaLabel={t("setAsideNamed", { description: transaction.description })} /> : null}
              {canManage && transaction.status === "EXCLUDED" ? <ActionForm action={setStatusAction.bind(null, company.id, transaction.id, "UNMATCHED")} label={t("restore")} ariaLabel={t("restoreNamed", { description: transaction.description })} /> : null}
            </li>
          ))}
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
