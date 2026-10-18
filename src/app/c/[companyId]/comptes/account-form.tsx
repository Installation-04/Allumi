"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Field, SelectField, StateError, SubmitButton } from "@/app/_components/ui";
import { ACCOUNT_TYPES, userCreatableSubtypes, type AccountType } from "@/modules/ledger/client";
import { createAccountAction } from "./actions";

export function AccountForm({ companyId }: { companyId: string }) {
  const t = useTranslations("accounts");
  const types = useTranslations("enums.accountType");
  const subtypes = useTranslations("enums.accountSubtype");
  const [state, action] = useActionState(createAccountAction.bind(null, companyId), undefined);
  const [type, setType] = useState<AccountType>((state?.values?.type as AccountType | undefined) ?? "EXPENSE");
  const v = state?.values ?? {};
  return (
    <form action={action} className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-lg font-semibold">{t("add")}</h2>
      <StateError state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="code" label={t("code")} hint={t("codeHint")} defaultValue={v.code} autoComplete="off" />
        <div className="hidden sm:block" />
        <Field name="nameFr" label={t("nameFr")} defaultValue={v.nameFr} autoComplete="off" />
        <Field name="nameEn" label={t("nameEn")} defaultValue={v.nameEn} autoComplete="off" />
        <div>
          <label htmlFor="account-type" className="mb-1 block text-sm font-medium">
            {t("type")}
          </label>
          <select
            id="account-type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as AccountType)}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900"
          >
            {ACCOUNT_TYPES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {types(candidate)}
              </option>
            ))}
          </select>
        </div>
        <SelectField
          key={type}
          name="subtype"
          label={t("subtype")}
          options={userCreatableSubtypes(type).map((subtype) => ({ value: subtype, label: subtypes(subtype) }))}
          defaultValue={v.subtype}
        />
      </div>
      <Field name="description" label={t("description")} defaultValue={v.description} required={false} />
      <SubmitButton variant="primary">{t("create")}</SubmitButton>
    </form>
  );
}
