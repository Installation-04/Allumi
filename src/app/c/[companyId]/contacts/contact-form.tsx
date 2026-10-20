"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { CONTACT_KINDS, PROVINCES } from "@/modules/contacts/client";
import { Field, FormScopeProvider, SelectField, StateError, SubmitButton, useScopedAction } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { saveContactAction } from "./actions";

export function ContactForm({ companyId, contactId = null, initial = {} }: { companyId: string; contactId?: string | null; initial?: Record<string, string> }) {
  const t = useTranslations("contacts");
  const { state, formAction, scope } = useScopedAction(saveContactAction.bind(null, companyId, contactId));
  const notesId = useId();
  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-6">
      <StateError state={state} />
      <FormScopeProvider scope={scope}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField name="kind" label={t("kind")} defaultValue={initial.kind ?? "CUSTOMER"} options={CONTACT_KINDS.map((value) => ({ value, label: t(`kinds.${value}`) }))} />
          <Field name="displayName" label={t("displayName")} defaultValue={initial.displayName} autoComplete="organization" />
          <Field name="legalName" label={t("legalName")} defaultValue={initial.legalName} required={false} />
          <Field name="email" label={t("email")} type="email" defaultValue={initial.email} required={false} autoComplete="email" />
          <Field name="phone" label={t("phone")} type="tel" defaultValue={initial.phone} required={false} autoComplete="tel" />
          <SelectField name="locale" label={t("locale")} defaultValue={initial.locale ?? "fr_CA"} options={[{ value: "fr_CA", label: "Français" }, { value: "en", label: "English" }]} />
          <Field name="paymentTermsDays" type="number" label={t("paymentTermsDays")} hint={t("termsHint")} defaultValue={initial.paymentTermsDays ?? "30"} />
          <Field name="addressLine1" label={t("addressLine1")} defaultValue={initial.addressLine1} required={false} autoComplete="address-line1" />
          <Field name="addressLine2" label={t("addressLine2")} defaultValue={initial.addressLine2} required={false} autoComplete="address-line2" />
          <Field name="city" label={t("city")} defaultValue={initial.city} required={false} autoComplete="address-level2" />
          <SelectField name="province" label={t("province")} defaultValue={initial.province ?? ""} required={false} options={[{ value: "", label: t("unspecified") }, ...PROVINCES.map((value) => ({ value, label: value }))]} />
          <Field name="postalCode" label={t("postalCode")} defaultValue={initial.postalCode} required={false} autoComplete="postal-code" />
          <Field name="country" label={t("country")} hint={t("countryHint")} defaultValue={initial.country ?? "CA"} autoComplete="country" />
        </div>
        <div>
          <label htmlFor={notesId} className="mb-1 block text-sm font-medium">{t("notes")}</label>
          <textarea id={notesId} name="notes" rows={3} maxLength={5000} defaultValue={scope.values?.notes ?? initial.notes} className={`w-full rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </div>
      </FormScopeProvider>
      <SubmitButton>{contactId ? t("save") : t("create")}</SubmitButton>
    </form>
  );
}
