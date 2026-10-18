import { getTranslations } from "next-intl/server";
import { CheckboxField, Field, SelectField, TextAreaField } from "@/app/_components/ui";
import { PROVINCES } from "@/modules/companies";
import type { ContactDto } from "@/modules/contacts";
import type { TaxCodeDto } from "@/modules/taxes";

const legend = "mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400";

/** The boxes of a contact, for the creation and the edition forms. They sit inside an ActionForm. */
export async function ContactFields({ contact, taxCodes, locale }: { contact?: ContactDto; taxCodes: TaxCodeDto[]; locale: "fr-CA" | "en" }) {
  const [t, provinces, locales] = [await getTranslations("contacts"), await getTranslations("enums.province"), await getTranslations("enums.locale")];
  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className={legend}>{t("identity")}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <CheckboxField name="isCustomer" label={t("isCustomer")} defaultChecked={contact ? contact.isCustomer : true} />
          <CheckboxField name="isSupplier" label={t("isSupplier")} defaultChecked={contact?.isSupplier ?? false} />
        </div>
        <Field name="displayName" label={t("displayName")} defaultValue={contact?.displayName} autoComplete="off" />
        <Field name="legalName" label={t("legalName")} defaultValue={contact?.legalName ?? ""} required={false} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="email" type="email" label={t("email")} defaultValue={contact?.email ?? ""} required={false} autoComplete="off" />
          <Field name="phone" type="tel" label={t("phone")} defaultValue={contact?.phone ?? ""} required={false} autoComplete="off" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={legend}>{t("address")}</legend>
        <Field name="addressLine1" label={t("addressLine1")} defaultValue={contact?.addressLine1 ?? ""} required={false} autoComplete="off" />
        <Field name="addressLine2" label={t("addressLine2")} defaultValue={contact?.addressLine2 ?? ""} required={false} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field name="city" label={t("city")} defaultValue={contact?.city ?? ""} required={false} autoComplete="off" />
          <SelectField
            name="province"
            label={t("province")}
            required={false}
            defaultValue={contact?.province ?? ""}
            options={[{ value: "", label: t("noProvince") }, ...PROVINCES.map((code) => ({ value: code, label: provinces(code) }))]}
          />
          <Field name="postalCode" label={t("postalCode")} defaultValue={contact?.postalCode ?? ""} required={false} autoComplete="off" />
          <Field name="country" label={t("country")} hint={t("countryHint")} defaultValue={contact?.country ?? "CA"} required={false} autoComplete="off" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={legend}>{t("billing")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField name="locale" label={t("locale")} defaultValue={contact?.locale ?? "fr_CA"} options={(["fr_CA", "en"] as const).map((code) => ({ value: code, label: locales(code) }))} />
          <Field name="paymentTermsDays" label={t("paymentTermsDays")} hint={t("paymentTermsHint")} defaultValue={String(contact?.paymentTermsDays ?? 30)} inputMode="numeric" autoComplete="off" />
          <SelectField
            name="defaultTaxCodeId"
            label={t("defaultTaxCode")}
            required={false}
            defaultValue={contact?.defaultTaxCodeId ?? ""}
            options={[{ value: "", label: t("noTaxCode") }, ...taxCodes.filter((code) => code.isActive || code.id === contact?.defaultTaxCodeId).map((code) => ({ value: code.id, label: `${code.code} – ${locale === "en" ? code.nameEn : code.nameFr}` }))]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="gstNumber" label={t("gstNumber")} hint={t("gstNumberHint")} defaultValue={contact?.gstNumber ?? ""} required={false} autoComplete="off" />
          <Field name="qstNumber" label={t("qstNumber")} hint={t("qstNumberHint")} defaultValue={contact?.qstNumber ?? ""} required={false} autoComplete="off" />
          <Field name="taxExemptionNumber" label={t("taxExemptionNumber")} defaultValue={contact?.taxExemptionNumber ?? ""} required={false} autoComplete="off" />
        </div>
        <TextAreaField name="notes" label={t("notes")} defaultValue={contact?.notes ?? ""} />
      </fieldset>
    </div>
  );
}
