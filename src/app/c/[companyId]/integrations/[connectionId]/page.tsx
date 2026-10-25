import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getConnection, listFeeAccounts } from "@/modules/integrations";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { searchText } from "@/app/_lib/search-params";
import { accountName, loadCompany } from "../../_lib";
import { validId } from "../../factures/editor";
import { disconnectAction, replaceCredentialsAction, setFeeAccountAction, syncAction, collectPaymentsAction } from "../actions";
import { CollectNotice } from "../collect-notice";

export async function generateMetadata() { return { title: (await getTranslations("integrations"))("title") }; }

const stamp = (date: Date) => `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;

export default async function ConnectionPage({ params, searchParams }: { params: Promise<{ companyId: string; connectionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params);
  const { connectionId } = await params;
  if (!validId(connectionId)) notFound();
  const connection = await getConnection(actor, connectionId);
  if (!connection) notFound();
  const query = await searchParams;
  const t = await getTranslations("integrations");
  const te = await getTranslations("errors");
  const to = await getTranslations("onlinePayments");
  const base = `/c/${company.id}`;
  const isOwner = can(company.role, "integration.manage");
  const imported = Number(searchText(query.imported));
  const justSynced = searchText(query.imported) !== undefined && Number.isInteger(imported) && imported >= 0;
  const skipped = Number(searchText(query.skipped)) || 0;
  const online = isOwner && connection.status === "ACTIVE" && connection.provider === "STRIPE";
  const feeAccounts = online ? await listFeeAccounts(actor) : [];
  const rows: [string, React.ReactNode][] = [
    [t("serviceLabel"), `${t(`providers.${connection.provider}`)}${connection.sandbox ? ` · ${t("test")}` : ""}`],
    [t("accountField"), `${connection.accountCode} · ${accountName({ nameFr: connection.accountNameFr, nameEn: connection.accountNameEn }, locale)}`],
    [t("importFromField"), connection.importFrom],
    ...(connection.credentialsHint ? [[t("keyHint"), `…${connection.credentialsHint}`] as [string, React.ReactNode]] : []),
    [t("lastSync"), connection.lastSyncedAt ? stamp(connection.lastSyncedAt) : t("neverSynced")],
    ...(connection.provider === "STRIPE"
      ? [[to("feeAccountField"), connection.feeAccountId ? `${connection.feeAccountCode} · ${accountName({ nameFr: connection.feeAccountNameFr ?? "", nameEn: connection.feeAccountNameEn ?? "" }, locale)}` : to("feeAccountNone")] as [string, React.ReactNode]]
      : []),
  ];
  return (
    <section className="max-w-3xl space-y-5 break-words">
      <Link href={`${base}/integrations`} className={`inline-flex min-h-11 items-center rounded text-sm underline ${FOCUS}`}>{t("back")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{connection.label}</h1>
        <span className="rounded-full bg-stone-200 px-3 py-1 text-sm dark:bg-stone-800">{t(`statuses.${connection.status}`)}</span>
      </div>
      {justSynced ? (
        <p role="status" className="rounded border border-brand-700 p-3 text-sm">
          {t("syncResult", { count: imported })}{skipped > 0 ? ` ${t("syncSkipped", { count: skipped })}` : ""}{searchText(query.more) === "1" ? ` ${t("syncMore")}` : ""}
        </p>
      ) : null}
      {searchText(query.keys) === "1" ? <p role="status" className="rounded border border-brand-700 p-3 text-sm">{t("keysReplaced")}</p> : null}
      {connection.lastSyncOk === false && connection.lastError ? <p role="alert" className="rounded border border-red-600 p-3 text-sm">{t("lastFailedWith", { reason: te(connection.lastError as "integrations.failed") })}</p> : null}
      <dl className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:grid-cols-2">
        {rows.map(([label, value]) => <div key={label}><dt className="text-sm text-stone-600 dark:text-stone-400">{label}</dt><dd>{value}</dd></div>)}
        <div><dt className="text-sm text-stone-600 dark:text-stone-400">{t("transactions")}</dt><dd><Link href={`${base}/transactions?connection=${connection.id}`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{t("transactionCount", { count: connection.transactionCount })}</Link></dd></div>
      </dl>
      {connection.sandbox ? <p className="text-sm">{t("testNotice")}</p> : null}
      {isOwner && connection.status === "ACTIVE" ? (
        <div className="space-y-2">
          <ActionForm action={syncAction.bind(null, company.id, connection.id)} label={t("sync")} variant="primary" />
          <p className="text-sm text-stone-600 dark:text-stone-400">{t("syncHint")}</p>
          {connection.syncing ? <p className="text-sm">{t("syncing")}</p> : null}
        </div>
      ) : null}
      <CollectNotice query={query} />
      {online ? (
        <section className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="online-title">
          <h2 id="online-title" className="font-semibold">{to("feeSection")}</h2>
          <ActionForm action={setFeeAccountAction.bind(null, company.id, connection.id)} label={to("feeAccountSubmit")}>
            <SelectField
              name="accountId" label={to("feeAccountField")} hint={`${to("feeAccountHint")} ${to("feeAccountApplies")}`} defaultValue={connection.feeAccountId ?? undefined}
              options={feeAccounts.map((account) => ({ value: account.id, label: `${account.code} · ${accountName(account, locale)}` }))}
            />
          </ActionForm>
          {connection.feeAccountId ? (
            <div className="space-y-2">
              <ActionForm action={collectPaymentsAction.bind(null, company.id, connection.id, `${base}/integrations/${connection.id}`)} label={to("collectButton")} variant="primary" />
              <p className="text-sm text-stone-600 dark:text-stone-400">{to("collectConnectionHint")}</p>
            </div>
          ) : null}
          <p className="text-sm text-stone-600 dark:text-stone-400">{to("keysHint")}</p>
        </section>
      ) : null}
      {isOwner ? (
        <details className="rounded border border-stone-300 p-4 dark:border-stone-700">
          <summary className="min-h-11 cursor-pointer">{t("replaceKeys")}</summary>
          <div className="mt-3">
            <ActionForm action={replaceCredentialsAction.bind(null, company.id, connection.id, connection.provider)} label={t("replaceSubmit")}>
              <p className="text-sm">{t("replaceHint")}</p>
              {connection.provider === "STRIPE" ? (
                <Field name="apiKey" type="password" label={t("apiKeyField")} hint={t("apiKeyHint")} autoComplete="off" />
              ) : (
                <>
                  <Field name="clientId" label={t("clientIdField")} autoComplete="off" />
                  <Field name="clientSecret" type="password" label={t("clientSecretField")} hint={t("clientSecretHint")} autoComplete="off" />
                </>
              )}
            </ActionForm>
          </div>
        </details>
      ) : null}
      {isOwner && connection.status === "ACTIVE" ? (
        <details className="rounded border border-stone-300 p-4 dark:border-stone-700">
          <summary className="min-h-11 cursor-pointer">{t("disconnect")}</summary>
          <div className="mt-3">
            <ActionForm action={disconnectAction.bind(null, company.id, connection.id)} label={t("disconnectSubmit")}>
              <p className="text-sm">{t("disconnectWarning")}</p>
              <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmDisconnect")}</label>
            </ActionForm>
          </div>
        </details>
      ) : null}
      {!isOwner ? <p className="text-sm text-stone-600 dark:text-stone-400">{t("ownerOnly")}</p> : null}
    </section>
  );
}
