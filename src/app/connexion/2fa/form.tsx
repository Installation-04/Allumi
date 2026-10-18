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
        {/* No numeric keypad here: a recovery code (letters and digits) is accepted too. */}
        <Field name="code" label={t("form.codeOrRecovery")} autoComplete="one-time-code" />
        <SubmitButton>{t("mfa.submit")}</SubmitButton>
      </form>
      <form action={logoutAction}>
        <SubmitButton variant="secondary">{t("mfa.cancel")}</SubmitButton>
      </form>
    </div>
  );
}
