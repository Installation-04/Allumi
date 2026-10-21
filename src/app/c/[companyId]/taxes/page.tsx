import { getTranslations } from "next-intl/server";
import { loadCompany, accountName } from "../_lib";
import { can } from "@/modules/companies";
import { listAccounts, todayIso } from "@/modules/ledger";
import { getTaxConfiguration, ratePercentage } from "@/modules/taxes";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { TaxPreview } from "./preview";
import { configureAction, archiveAction } from "./actions";

export default async function TaxesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const t = await getTranslations("catalog");
  const { taxes, codes } = await getTaxConfiguration(actor);
  const accounts = await listAccounts(actor);
  const manage = can(company.role, "catalog.manage");
  const none = { value: "", label: t("none") };
  const taxOptions = [none, ...taxes.filter((tax) => tax.isActive).map((tax) => ({ value: tax.id, label: `${tax.code} — ${locale === "en" ? tax.nameEn : tax.nameFr}` }))];
  const accountOptions = (type: "ASSET" | "LIABILITY") => [none, ...accounts.filter((a) => a.subtype === "SALES_TAX" && a.type === type).map((a) => ({ value: a.id, label: `${a.code} — ${accountName(a, locale)}` }))];
  const names = <><Field name="code" label={t("code")} /><Field name="nameFr" label={t("nameFr")} /><Field name="nameEn" label={t("nameEn")} /></>;
  const panel = "space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900";
  return <section className="space-y-6">
    <h1 className="text-2xl font-semibold">{t("taxes")}</h1><p className="max-w-3xl text-sm text-stone-600 dark:text-stone-400">{t("taxIntro")}</p>
    <div className="grid gap-4 lg:grid-cols-2">{taxes.map((tax) => <article key={tax.id} className={panel}>
      <h2 className="font-semibold">{tax.code} — {locale === "en" ? tax.nameEn : tax.nameFr}</h2>
      <ul className="space-y-2 text-sm">{tax.rates.map((rate) => <li key={rate.id}>{ratePercentage(rate.rate)} % · {rate.from} → {rate.to ?? t("ongoing")}</li>)}</ul>
    </article>)}</div>{taxes.length === 0 && <p>{t("emptyTaxes")}</p>}
    <h2 className="text-xl font-semibold">{t("taxCodes")}</h2>
    <div className="grid gap-4 lg:grid-cols-2">{codes.map((code) => <article key={code.id} className={panel}><h3 className="font-semibold">{code.code} — {locale === "en" ? code.nameEn : code.nameFr}</h3><p>{t(`treatments.${code.treatment}`)} · {t(code.isActive ? "active" : "archived")}</p><p className="text-sm">{code.components.map((c) => taxes.find((tax) => tax.id === c.taxId)?.code).join(" + ")}</p>{manage && <ActionForm action={archiveAction.bind(null, company.id, "taxCode", code.id, !code.isActive)} label={t(code.isActive ? "archive" : "restore")} ariaLabel={`${t(code.isActive ? "archive" : "restore")} ${code.code}`} />}</article>)}</div>
    <TaxPreview locale={locale} today={todayIso()} codes={codes.filter((c) => c.isActive).map((c) => ({ id: c.id, label: c.code, taxIds: c.components.map((part) => part.taxId) }))} taxes={taxes.filter((tax) => tax.isActive).map((tax) => ({ id: tax.id, code: tax.code, rates: tax.rates }))} />
    {manage && <div className="grid gap-6 xl:grid-cols-2">
      <section className={panel}><h2 className="text-lg font-semibold">{t("newTax")}</h2><ActionForm action={configureAction.bind(null, company.id, "tax")} label={t("newTax")} variant="primary"><div className="grid gap-4 sm:grid-cols-2">{names}<Field name="percent" label={t("percent")} hint={t("percentHint")} /><Field name="from" label={t("from")} type="date" defaultValue={todayIso()} /><SelectField name="payableAccountId" label={t("payable")} options={accountOptions("LIABILITY")} /><SelectField name="recoverableAccountId" label={t("recoverable")} options={accountOptions("ASSET")} required={false} /></div></ActionForm></section>
      <section className={panel}><h2 className="text-lg font-semibold">{t("newCode")}</h2><ActionForm action={configureAction.bind(null, company.id, "code")} label={t("newCode")} variant="primary"><div className="grid gap-4 sm:grid-cols-2">{names}<SelectField name="treatment" label={t("treatment")} options={["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"].map((value) => ({ value, label: t(`treatments.${value as "STANDARD"}`) }))} /><SelectField name="tax1" label={t("tax1")} options={taxOptions} required={false} /><SelectField name="tax2" label={t("tax2")} options={taxOptions} required={false} /></div></ActionForm></section>
      <section className={panel}><h2 className="text-lg font-semibold">{t("schedule")}</h2><p className="text-sm">{t("scheduleHint")}</p><ActionForm action={configureAction.bind(null, company.id, "rate")} label={t("schedule")}><div className="grid gap-4 sm:grid-cols-2"><SelectField name="taxId" label={t("tax")} options={taxOptions} /><Field name="percent" label={t("percent")} /><Field name="from" label={t("from")} type="date" /></div></ActionForm></section>
    </div>}
  </section>;
}
