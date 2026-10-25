"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/app/_components/ui";
import { beginEnrollmentAction, changePasswordAction, confirmEnrollmentAction, disableTotpAction } from "./actions";

/**
 * The whole two-factor section lives in ONE client component whose place in the tree never changes.
 * The recovery codes are shown once, from the state of the confirmation form: if this component were
 * swapped for another when the page re-renders (for example after a language switch, which refreshes the
 * layout), that state would be lost and so would the codes.
 */
export function TwoFactorPanel({
  enabled,
  recoveryCodesLeft,
  enrollment,
}: {
  enabled: boolean;
  recoveryCodesLeft: number;
  enrollment: { qr: string; secret: string } | null;
}) {
  const t = useTranslations("security");
  const tForm = useTranslations();
  const [state, confirmAction] = useActionState(confirmEnrollmentAction, undefined);

  if (state?.recoveryCodes) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("recoveryTitle")}</h2>
        <p className="text-sm">{t("recoveryIntro")}</p>
        <ul aria-label={t("recoveryTitle")} className="grid grid-cols-2 gap-2 rounded-md border border-stone-300 bg-stone-100 p-4 font-mono text-sm dark:border-stone-700 dark:bg-stone-800">
          {state.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (enabled) {
    return (
      <>
        <p className="text-sm">{t("twoFactorOn", { count: recoveryCodesLeft })}</p>
        <DisableForm />
      </>
    );
  }

  if (enrollment) {
    return (
      <form action={confirmAction} className="space-y-4">
        <p className="text-sm">{t("scan")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated on the server */}
        <img src={enrollment.qr} alt="" width={220} height={220} className="rounded-md border border-stone-300 bg-white p-2" />
        <p className="text-xs">
          {t("manualKey")} <code className="break-all font-mono">{enrollment.secret}</code>
        </p>
        {state?.error ? <FormError message={tForm(`errors.form.${state.error}`, { min: 12 })} /> : null}
        <p className="text-sm">{t("enrollPasswordHint")}</p>
        <Field name="password" type="password" label={tForm("form.password")} autoComplete="current-password" />
        <Field name="code" label={tForm("form.code")} autoComplete="one-time-code" inputMode="numeric" />
        <SubmitButton>{t("confirm")}</SubmitButton>
      </form>
    );
  }

  return (
    <>
      <p className="text-sm">{t("twoFactorOff")}</p>
      <form action={beginEnrollmentAction}>
        <SubmitButton>{t("enable")}</SubmitButton>
      </form>
    </>
  );
}

function DisableForm() {
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

export function PasswordForm() {
  const t = useTranslations();
  const [state, action] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm">{t("security.passwordHint", { min: 12 })}</p>
      {state?.error ? <FormError message={t(`errors.form.${state.error}`, { min: 12 })} /> : null}
      {state?.notice === "saved" ? (
        <p role="status" className="text-brand-700 dark:text-brand-500">
          {t("security.passwordChanged")}
        </p>
      ) : null}
      <Field name="currentPassword" type="password" label={t("security.currentPassword")} autoComplete="current-password" />
      <Field name="newPassword" type="password" label={t("security.newPassword")} autoComplete="new-password" />
      <Field name="newPasswordConfirm" type="password" label={t("form.passwordConfirm")} autoComplete="new-password" />
      <SubmitButton>{t("security.changePassword")}</SubmitButton>
    </form>
  );
}
