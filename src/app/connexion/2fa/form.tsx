"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/app/_components/ui";
import { logoutAction } from "../actions";
import { mfaAction } from "./actions";

export function MfaForm() {
  const t = useTranslations();
  const [state, action] = useActionState(mfaAction, undefined);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {state?.error ? <FormError message={t(`errors.form.${state.error}`, { min: 12 })} /> : null}
        <Field name="code" label={t("form.code")} autoComplete="one-time-code" inputMode="numeric" />
        <SubmitButton>{t("mfa.submit")}</SubmitButton>
      </form>
      <form action={logoutAction}>
        <SubmitButton variant="secondary">{t("mfa.cancel")}</SubmitButton>
      </form>
    </div>
  );
}
