import { getLocale, getTranslations } from "next-intl/server";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { can, FILING_FREQUENCIES, getCompanyProfile, LOCALES, PROVINCES, TAX_ROUNDINGS } from "@/modules/companies";
import { loadCompany } from "../_lib";
import { updateCompanyAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("companyPage"))("title") };
}

export default async function CompanyProfilePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor } = await loadCompany(params);
  const [t, provinces, locales, roundings, frequencies, months] = [
    await getTranslations("companyPage"),
    await getTranslations("enums.province"),
    await getTranslations("enums.locale"),
    await getTranslations("enums.taxRounding"),
    await getTranslations("enums.filingFrequency"),
    await getTranslations("months"),
  ];
  const locale = await getLocale();
  const profile = await getCompanyProfile(actor);
  const manage = can(company, "company.manage");
  // the month names of the messages are for lists ("Janvier"); inside a French sentence they are lower case
  const monthInSentence = (name: string) => (locale.startsWith("fr") ? name.toLocaleLowerCase("fr-CA") : name);

  if (!manage) {
    // Read-only members see the identity that is printed on documents, not a form.
    const rows: [string, string | null][] = [
      [t("name"), profile.name],
      [t("legalName"), profile.legalName],
      [t("neq"), profile.neq],
      [t("businessNumber"), profile.businessNumber],
      [t("gstNumber"), profile.gstNumber],
      [t("qstNumber"), profile.qstNumber],
      [t("addressLine1"), profile.addressLine1],
      [t("addressLine2"), profile.addressLine2],
      [t("city"), profile.city],
      [t("postalCode"), profile.postalCode],
      [t("email"), profile.email],
      [t("phone"), profile.phone],
      [t("defaultLocale"), locales(profile.defaultLocale)],
      [t("province"), provinces(profile.province)],
      [t("taxRounding"), roundings(profile.taxRounding)],
      [t("taxFilingFrequency"), frequencies(profile.taxFilingFrequency)],
    ];
    return (
      <section className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-stone-700 dark:text-stone-300">{t("readOnly")}</p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[14rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="min-w-0 break-words text-sm">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("intro")}</p>
      <ActionForm action={updateCompanyAction.bind(null, company.id)} label={t("save")} variant="primary">
        <fieldset className="space-y-4">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{t("identity")}</legend>
          <Field name="name" label={t("name")} defaultValue={profile.name} autoComplete="organization" />
          <Field name="legalName" label={t("legalName")} defaultValue={profile.legalName ?? ""} required={false} autoComplete="off" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="neq" label={t("neq")} hint={t("neqHint")} defaultValue={profile.neq ?? ""} required={false} inputMode="numeric" autoComplete="off" />
            <Field name="businessNumber" label={t("businessNumber")} hint={t("businessNumberHint")} defaultValue={profile.businessNumber ?? ""} required={false} inputMode="numeric" autoComplete="off" />
            <Field name="gstNumber" label={t("gstNumber")} hint={t("gstNumberHint")} defaultValue={profile.gstNumber ?? ""} required={false} autoComplete="off" />
            <Field name="qstNumber" label={t("qstNumber")} hint={t("qstNumberHint")} defaultValue={profile.qstNumber ?? ""} required={false} autoComplete="off" />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{t("address")}</legend>
          <Field name="addressLine1" label={t("addressLine1")} defaultValue={profile.addressLine1 ?? ""} required={false} autoComplete="address-line1" />
          <Field name="addressLine2" label={t("addressLine2")} defaultValue={profile.addressLine2 ?? ""} required={false} autoComplete="address-line2" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="city" label={t("city")} defaultValue={profile.city ?? ""} required={false} autoComplete="address-level2" />
            <SelectField name="province" label={t("province")} defaultValue={profile.province} options={PROVINCES.map((code) => ({ value: code, label: provinces(code) }))} />
            <Field name="postalCode" label={t("postalCode")} defaultValue={profile.postalCode ?? ""} required={false} autoComplete="postal-code" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="email" type="email" label={t("email")} defaultValue={profile.email ?? ""} required={false} autoComplete="email" />
            <Field name="phone" type="tel" label={t("phone")} defaultValue={profile.phone ?? ""} required={false} autoComplete="tel" />
          </div>
        </fieldset>

        <fieldset id="fiscal-settings" className="scroll-mt-6 space-y-4">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{t("settings")}</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField name="defaultLocale" label={t("defaultLocale")} defaultValue={profile.defaultLocale} options={LOCALES.map((code) => ({ value: code, label: locales(code) }))} />
            <SelectField name="taxRounding" label={t("taxRounding")} hint={t("taxRoundingHint")} defaultValue={profile.taxRounding} options={TAX_ROUNDINGS.map((code) => ({ value: code, label: roundings(code) }))} />
            <SelectField name="taxFilingFrequency" label={t("taxFilingFrequency")} defaultValue={profile.taxFilingFrequency} options={FILING_FREQUENCIES.map((code) => ({ value: code, label: frequencies(code) }))} />
          </div>
          <p className="text-sm">{t("fiscalYearStart", { month: monthInSentence(months(String(profile.fiscalYearStartMonth) as "1")) })}</p>
        </fieldset>
      </ActionForm>
    </section>
  );
}
