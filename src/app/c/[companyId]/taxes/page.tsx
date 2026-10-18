import { getTranslations } from "next-intl/server";
import { ActionForm, CheckboxField, CheckboxGroup, Field, SelectField } from "@/app/_components/ui";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { can } from "@/modules/companies";
import { listAccounts } from "@/modules/ledger";
import { formatPercent, listTaxCodes, listTaxes, TAX_TREATMENTS } from "@/modules/taxes";
import { accountName, loadCompany } from "../_lib";
import { addRateAction, createTaxAction, createTaxCodeAction, installTaxesAction, setTaxActiveAction, setTaxCodeActiveAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("taxes"))("title") };
}

export default async function TaxesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const [t, treatments] = [await getTranslations("taxes"), await getTranslations("enums.taxTreatment")];
  const [taxes, codes, accounts] = await Promise.all([listTaxes(actor), listTaxCodes(actor), listAccounts(actor, { includeInactive: true })]);
  const manage = can(company.role, "tax.manage");
  const accountLabel = (id: string | null) => {
    const account = accounts.find((candidate) => candidate.id === id);
    return account ? `${account.code} – ${accountName(account, locale)}` : "—";
  };
  const taxName = (tax: { nameFr: string; nameEn: string }) => (locale === "en" ? tax.nameEn : tax.nameFr);

  return (
    <section className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-stone-700 dark:text-stone-300">{t("intro")}</p>
        <p className="text-sm text-stone-700 dark:text-stone-300">{t("verify")}</p>
      </div>

      {taxes.length === 0 && manage ? (
        <div className="max-w-xl space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="text-lg font-semibold">{t("installTitle")}</h2>
          <p className="text-sm">{t("installIntro")}</p>
          <ActionForm action={installTaxesAction.bind(null, company.id)} label={t("install")} variant="primary" />
        </div>
      ) : null}

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">{t("taxesTitle")}</h2>
        {taxes.length === 0 ? (
          <p>{t("noTaxes")}</p>
        ) : (
          <div className="space-y-6">
            {taxes.map((tax) => (
              <article key={tax.id} aria-labelledby={`tax-${tax.id}`} className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id={`tax-${tax.id}`} className="text-lg font-semibold">
                    <span className="font-mono">{tax.code}</span> – {taxName(tax)}
                  </h3>
                  <p className="text-sm">
                    {tax.currentRateMicro === null ? t("noCurrentRate") : t("currentRate", { rate: formatPercent(tax.currentRateMicro, locale) })}
                    {" · "}
                    {tax.isActive ? t("active") : t("inactive")}
                  </p>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
                  <dt className="font-medium">{t("payableAccount")}</dt>
                  <dd>{accountLabel(tax.payableAccountId)}</dd>
                  <dt className="font-medium">{t("recoverableAccount")}</dt>
                  <dd>{accountLabel(tax.recoverableAccountId)}</dd>
                  {tax.registrationNumber ? (
                    <>
                      <dt className="font-medium">{t("registrationNumber")}</dt>
                      <dd>{tax.registrationNumber}</dd>
                    </>
                  ) : null}
                </dl>
                <div className="overflow-x-auto">
                  <table className={TABLE_CLASS}>
                    <caption className="sr-only">{t("history", { code: tax.code })}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={TH_CLASS}>{t("rate")}</th>
                        <th scope="col" className={TH_CLASS}>{t("from")}</th>
                        <th scope="col" className={TH_CLASS}>{t("to")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tax.rates.map((entry) => (
                        <tr key={entry.id}>
                          <td className={`${TD_CLASS} tabular-nums`}>{formatPercent(entry.rateMicro, locale)}</td>
                          <td className={`${TD_CLASS} tabular-nums`}>{entry.from}</td>
                          <td className={`${TD_CLASS} tabular-nums`}>{entry.to ?? t("inForce")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {manage ? (
                  <div className="flex flex-wrap items-start gap-6">
                    <ActionForm action={addRateAction.bind(null, company.id, tax.id)} label={t("addRate")} ariaLabel={t("addRateNamed", { code: tax.code })}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field name="rate" label={t("newRate")} hint={t("rateHint")} inputMode="decimal" autoComplete="off" />
                        <Field name="from" type="date" label={t("newFrom")} hint={t("fromHint")} />
                      </div>
                    </ActionForm>
                    <ActionForm
                      action={setTaxActiveAction.bind(null, company.id, tax.id, !tax.isActive)}
                      label={tax.isActive ? t("deactivate") : t("activate")}
                      ariaLabel={t(tax.isActive ? "deactivateNamed" : "activateNamed", { code: tax.code })}
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>

      {manage ? (
        <ActionForm action={createTaxAction.bind(null, company.id)} label={t("createTax")} variant="primary">
          <fieldset className="max-w-2xl space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <legend className="px-1 text-lg font-semibold">{t("newTax")}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="code" label={t("code")} hint={t("codeHint")} autoComplete="off" />
              <Field name="nameFr" label={t("nameFr")} autoComplete="off" />
              <Field name="nameEn" label={t("nameEn")} autoComplete="off" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="rate" label={t("firstRate")} hint={t("rateHint")} inputMode="decimal" autoComplete="off" />
              <Field name="from" type="date" label={t("firstFrom")} />
            </div>
            <Field name="registrationNumber" label={t("registrationNumber")} hint={t("registrationHint")} required={false} autoComplete="off" />
            <CheckboxField name="recoverable" label={t("recoverable")} hint={t("recoverableHint")} defaultChecked />
            <p className="text-xs text-stone-600 dark:text-stone-400">{t("accountsHint")}</p>
          </fieldset>
        </ActionForm>
      ) : null}

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">{t("codesTitle")}</h2>
        <p className="text-sm text-stone-700 dark:text-stone-300">{t("codesIntro")}</p>
        {codes.length === 0 ? (
          <p>{t("noCodes")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <caption className="sr-only">{t("codesTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH_CLASS}>{t("code")}</th>
                  <th scope="col" className={TH_CLASS}>{t("name")}</th>
                  <th scope="col" className={TH_CLASS}>{t("treatment")}</th>
                  <th scope="col" className={TH_CLASS}>{t("appliesTaxes")}</th>
                  <th scope="col" className={TH_CLASS}>{t("status")}</th>
                  {manage ? <th scope="col" className={TH_CLASS}>{t("actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr key={code.id}>
                    <td className={`${TD_CLASS} font-mono`}>{code.code}</td>
                    <td className={TD_CLASS}>{taxName(code)}</td>
                    <td className={TD_CLASS}>{treatments(code.treatment)}</td>
                    <td className={TD_CLASS}>{code.taxes.map((tax) => tax.code).join(" + ") || "—"}</td>
                    <td className={TD_CLASS}>{code.isActive ? t("active") : t("inactive")}</td>
                    {manage ? (
                      <td className={TD_CLASS}>
                        <ActionForm
                          action={setTaxCodeActiveAction.bind(null, company.id, code.id, !code.isActive)}
                          label={code.isActive ? t("deactivate") : t("activate")}
                          ariaLabel={t(code.isActive ? "deactivateNamed" : "activateNamed", { code: code.code })}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {manage && taxes.length > 0 ? (
        <ActionForm action={createTaxCodeAction.bind(null, company.id)} label={t("createCode")} variant="primary">
          <fieldset className="max-w-2xl space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <legend className="px-1 text-lg font-semibold">{t("newCode")}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="code" label={t("code")} hint={t("codeCodeHint")} autoComplete="off" />
              <Field name="nameFr" label={t("nameFr")} autoComplete="off" />
              <Field name="nameEn" label={t("nameEn")} autoComplete="off" />
            </div>
            <SelectField name="treatment" label={t("treatment")} hint={t("treatmentHint")} options={TAX_TREATMENTS.map((value) => ({ value, label: treatments(value) }))} />
            <CheckboxGroup name="taxIds" legend={t("appliesTaxes")} hint={t("taxesHint")} options={taxes.filter((tax) => tax.isActive).map((tax) => ({ value: tax.id, label: `${tax.code} – ${taxName(tax)}` }))} />
          </fieldset>
        </ActionForm>
      ) : null}
    </section>
  );
}
