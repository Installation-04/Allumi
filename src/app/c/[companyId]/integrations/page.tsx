import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { PROVIDERS, listConnectionAccounts, listConnections } from "@/modules/integrations";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../_lib";
import { ConnectForm } from "./connect-form";

export async function generateMetadata() { return { title: (await getTranslations("integrations"))("title") }; }

export default async function IntegrationsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const t = await getTranslations("integrations");
  const connections = await listConnections(actor);
  const canConnect = can(company.role, "integration.manage");
  const accounts = canConnect ? await listConnectionAccounts(actor) : [];
  const base = `/c/${company.id}`;
  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
      </div>
      <Link href={`${base}/transactions`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{t("openInbox")}</Link>
      {connections.length === 0 ? (
        <div className="border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-700 dark:bg-stone-900"><h2 className="font-semibold">{t("empty")}</h2><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t(canConnect ? "emptyOwner" : "emptyOther")}</p></div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {connections.map((connection) => (
            <li key={connection.id}>
              <Link href={`${base}/integrations/${connection.id}`} className={`block space-y-1 rounded border border-stone-300 bg-white p-5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>
                <h2 className="font-semibold break-words">{connection.label}</h2>
                <p>{t(`providers.${connection.provider}`)}{connection.sandbox ? ` · ${t("test")}` : ""}</p>
                <p className="text-sm">{t(`statuses.${connection.status}`)} · {t("transactionCount", { count: connection.transactionCount })}</p>
                {connection.lastSyncOk === false ? <p className="text-sm text-red-700 dark:text-red-400">{t("lastFailed")}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canConnect ? <div className="space-y-3">{PROVIDERS.map((provider) => <ConnectForm key={provider} companyId={company.id} provider={provider} accounts={accounts} locale={locale} />)}</div> : <p className="text-sm text-stone-600 dark:text-stone-400">{t("ownerOnly")}</p>}
    </section>
  );
}
