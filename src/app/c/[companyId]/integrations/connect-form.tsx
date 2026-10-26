import { getTranslations } from "next-intl/server";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { accountName } from "../_lib";
import type { Locale } from "@/modules/ledger";
import type { ProviderId } from "@/modules/integrations";
import { todayIso } from "@/modules/ledger";
import { connectAction } from "./actions";

/** One form per service, drawn from what the service asks for (see PROVIDER_DEFINITIONS). The secrets are password fields. */
export async function ConnectForm(props: { companyId: string; provider: ProviderId; accounts: { id: string; code: string; nameFr: string; nameEn: string }[]; locale: Locale }) {
  const { companyId, provider, accounts, locale } = props;
  const t = await getTranslations("integrations");
  return (
    <details className="rounded border border-stone-300 p-4 dark:border-stone-700">
      <summary className="min-h-11 cursor-pointer font-medium">{t("connect", { provider: t(`providers.${provider}`) })}</summary>
      <div className="mt-3">
        {accounts.length === 0 ? <p className="text-sm">{t("noAccount")}</p> : (
          <ActionForm action={connectAction.bind(null, companyId, provider)} label={t("connectSubmit")} variant="primary">
            <p className="text-sm">{t(`hint.${provider}`)}</p>
            <Field name="label" label={t("labelField")} defaultValue={t(`providers.${provider}`)} autoComplete="off" />
            <SelectField name="accountId" label={t("accountField")} hint={t("accountHint")} options={accounts.map((account) => ({ value: account.id, label: `${account.code} · ${accountName(account, locale)}` }))} />
            <Field name="importFrom" type="date" label={t("importFromField")} hint={t("importFromHint")} defaultValue={`${todayIso().slice(0, 4)}-01-01`} />
            {provider === "STRIPE" ? (
              <Field name="apiKey" type="password" label={t("apiKeyField")} hint={t("apiKeyHint")} autoComplete="off" />
            ) : (
              <>
                <SelectField name="environment" label={t("environmentField")} defaultValue="live" options={[{ value: "live", label: t("environments.live") }, { value: "sandbox", label: t("environments.sandbox") }]} />
                <Field name="clientId" label={t("clientIdField")} autoComplete="off" />
                <Field name="clientSecret" type="password" label={t("clientSecretField")} hint={t("clientSecretHint")} autoComplete="off" />
              </>
            )}
          </ActionForm>
        )}
      </div>
    </details>
  );
}
