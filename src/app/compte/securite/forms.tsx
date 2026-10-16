"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/app/_components/ui";
import { confirmEnrollmentAction, disableTotpAction } from "./actions";

export function ConfirmEnrollmentForm({ qr, secret }: { qr: string; secret: string }) {
  const t = useTranslations();
  const [state, action] = useActionState(confirmEnrollmentAction, undefined);

  if (state?.recoveryCodes) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("security.recoveryTitle")}</h2>
        <p className="text-sm">{t("security.recoveryIntro")}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-stone-300 bg-stone-100 p-4 font-mono text-sm dark:border-stone-700 dark:bg-stone-800">
          {state.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm">{t("security.scan")}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated on the server */}
      <img src={qr} alt="" width={220} height={220} className="rounded-md border border-stone-300 bg-white p-2" />
      <p className="text-xs">
        {t("security.manualKey")} : <code className="break-all font-mono">{secret}</code>
      </p>
      {state?.error ? <FormError message={t(`errors.form.${state.error}`, { min: 12 })} /> : null}
      <Field name="code" label={t("form.code")} autoComplete="one-time-code" inputMode="numeric" />
      <SubmitButton>{t("security.confirm")}</SubmitButton>
    </form>
  );
}

export function DisableForm() {
  const t = useTranslations();
  const [state, action] = useActionState(disableTotpAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm">{t("security.disableHint")}</p>
      {state?.error ? <FormError message={t(`errors.form.${state.error}`, { min: 12 })} /> : null}
      <Field name="password" type="password" label={t("form.password")} autoComplete="current-password" />
      <Field name="code" label={t("form.code")} autoComplete="one-time-code" inputMode="numeric" />
      <SubmitButton variant="secondary">{t("security.disable")}</SubmitButton>
    </form>
  );
}
