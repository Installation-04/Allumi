"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/app/_components/ui";
import { loginAction } from "./actions";

export function LoginForm() {
  const t = useTranslations();
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <FormError message={t(`errors.form.${state.error}`, { min: 12 })} /> : null}
      <Field name="email" type="email" label={t("form.email")} defaultValue={state?.values?.email} autoComplete="username" />
      <Field name="password" type="password" label={t("form.password")} autoComplete="current-password" />
      <SubmitButton>{t("login.submit")}</SubmitButton>
    </form>
  );
}
