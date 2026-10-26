import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { formatMoney, todayIso } from "@/modules/ledger";
import { listAccountReconciliations, listReconciliations } from "@/modules/banking";
import { ActionForm, Field } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../_lib";
import { startAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata() { return { title: (await getTranslations("reconciliation"))("title") }; }

export default async function ReconciliationPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const t = await getTranslations("reconciliation");
  const accounts = await listAccountReconciliations(actor);
  const canManage = can(company.role, "bank.manage");
  const base = `/c/${company.id}/rapprochement`;
  const link = `inline-flex min-h-11 items-center rounded px-1 underline ${FOCUS}`;
  const history = new Map(await Promise.all(accounts.map(async (account) => [account.accountId, await listReconciliations(actor, account.accountId)] as const)));
  const card = "space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900";
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
      </div>
      {accounts.length === 0 ? <p className="text-sm">{t("noAccounts")}</p> : (
        <ul className="space-y-4">
          {accounts.map((account) => {
            const past = (history.get(account.accountId) ?? []).filter((row) => row.status === "COMPLETED");
            return (
              <li key={account.accountId} className={card}>
                <h2 className="text-lg font-semibold break-words">{account.code} · {accountName(account, locale)}</h2>
                {account.lastCompleted ? (
                  <p className="text-sm">{t("lastDone")} : <Link href={`${base}/${account.lastCompleted.id}`} className={link}>{account.lastCompleted.statementDate}</Link> · <span className="tabular-nums">{formatMoney(account.lastCompleted.statementBalanceCents, locale)}</span></p>
                ) : <p className="text-sm">{t("neverDone")}</p>}
                {account.inProgress ? (
                  <p className="text-sm">
                    {t("inProgress", { date: account.inProgress.statementDate })} <span className="tabular-nums">{formatMoney(account.inProgress.statementBalanceCents, locale)}</span>{" "}
                    <Link href={`${base}/${account.inProgress.id}`} className={link} aria-label={t("continueNamed", { account: `${account.code} ${accountName(account, locale)}` })}>{t("continue")}</Link>
                  </p>
                ) : canManage ? (
                  <ActionForm action={startAction.bind(null, company.id)} label={t("start")} ariaLabel={t("startNamed", { account: `${account.code} ${accountName(account, locale)}` })} variant="primary">
                    <input type="hidden" name="accountId" value={account.accountId} />
                    <Field name="statementDate" type="date" label={t("statementDate")} defaultValue={todayIso()} hint={t("statementDateHint")} />
                    <Field name="balance" label={t(account.subtype === "CREDIT_CARD" ? "balanceCard" : "balance")} inputMode="decimal" autoComplete="off" hint={t(account.subtype === "CREDIT_CARD" ? "balanceCardHint" : "balanceHint")} />
                  </ActionForm>
                ) : null}
                {past.length > 1 ? (
                  <details className="text-sm">
                    <summary className={`inline-flex min-h-11 cursor-pointer items-center rounded ${FOCUS}`}>{t("history", { count: past.length })}</summary>
                    <ul className="mt-1 space-y-1">
                      {past.map((row) => <li key={row.id}><Link href={`${base}/${row.id}`} className={link}>{row.statementDate}</Link> · <span className="tabular-nums">{formatMoney(row.statementBalanceCents, locale)}</span></li>)}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
