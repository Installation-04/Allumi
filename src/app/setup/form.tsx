"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/app/_components/ui";
import { setupAction } from "./actions";

export function SetupForm({ passwordMin, defaultLocale, tokenRequired }: { passwordMin: number; defaultLocale: "fr-CA" | "en"; tokenRequired: boolean }) {
  const t = useTranslations();
  const [state, action] = useActionState(setupAction, undefined);
  const v = state?.values ?? {};
  return (
    <form action={action} className="space-y-6">
      {state?.error ? <FormError message={t(`errors.form.${state.error}`, { min: passwordMin })} /> : null}

      {tokenRequired ? (
        <Field name="setupToken" label={t("setup.token")} hint={t("setup.tokenHint")} autoComplete="off" />
      ) : null}

      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{t("setup.company")}</legend>
        <Field name="companyName" label={t("setup.companyName")} defaultValue={v.companyName} autoComplete="organization" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("setup.fiscalYearStart")}</span>
          <select
            name="fiscalYearStartMonth"
            defaultValue={v.fiscalYearStartMonth ?? "1"}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900"
          >
            {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((month) => (
              <option key={month} value={month}>
                {t(`months.${month}` as "months.1")}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{t("setup.admin")}</legend>
        <Field name="displayName" label={t("setup.displayName")} defaultValue={v.displayName} autoComplete="name" />
        <Field name="email" type="email" label={t("form.email")} defaultValue={v.email} autoComplete="username" />
        <Field name="password" type="password" label={t("form.password")} autoComplete="new-password" hint={t("setup.passwordHint", { min: passwordMin })} />
        <Field name="passwordConfirm" type="password" label={t("form.passwordConfirm")} autoComplete="new-password" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("setup.locale")}</span>
          <select
            name="locale"
            defaultValue={v.locale ?? defaultLocale}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900"
          >
            <option value="fr-CA">{t("common.french")}</option>
            <option value="en">{t("common.english")}</option>
          </select>
        </label>
      </fieldset>

      <SubmitButton>{t("setup.submit")}</SubmitButton>
    </form>
  );
}
