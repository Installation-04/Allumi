"use client";
import { useTranslations } from "next-intl";
import { Field, SelectField, StateError, SubmitButton, useScopedAction, FormScopeProvider } from "@/app/_components/ui";
import type { FormState } from "@/app/_lib/form-state";
const ROLES = ["OWNER", "USER", "READ_ONLY", "ACCOUNTANT"] as const;
const MODULES = ["contacts", "catalog", "sales", "accounting", "taxes", "audit"] as const;
export function PermissionFields({ role = "USER", access = {} }: { role?: string; access?: unknown }) {
  const t = useTranslations("members");
  const roles = useTranslations("dashboard.roles");
  return <><SelectField name="role" label={t("role")} defaultValue={role} options={ROLES.map(value => ({ value, label: roles(value) }))} /><details className="rounded border p-3"><summary className="min-h-11 cursor-pointer">{t("permissions")}</summary><p className="mb-3 text-sm">{t("permissionHint")}</p><div className="grid gap-3 sm:grid-cols-2">{MODULES.map(m => <SelectField key={m} name={m} label={t(`modules.${m}`)} defaultValue={(access as Record<string, string> | null)?.[m] ?? "default"} options={(["default", "none", "read", "write"] as const).map(value => ({ value, label: t(`levels.${value}`) }))} />)}</div></details></>;
}
export function InviteForm({ action }: { action: (state: FormState, form: FormData) => Promise<FormState> }) {
  const { state, formAction, scope } = useScopedAction(action);
  const t = useTranslations("members");
  return <form action={formAction} className="space-y-4"><StateError state={state} />{state?.invitationCode && <div role="status" className="space-y-2 rounded border border-brand-700 p-4"><p>{t("share")}</p><code className="block break-all select-all" data-testid="invitation-code">{state.invitationCode}</code><p>{t("sharePath")}</p></div>}<FormScopeProvider scope={scope}><Field name="email" type="email" label={t("email")} autoComplete="off" /><PermissionFields /></FormScopeProvider><SubmitButton>{t("invite")}</SubmitButton></form>;
}
