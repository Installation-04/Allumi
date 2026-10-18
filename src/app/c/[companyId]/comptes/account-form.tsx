"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Field, FormScopeProvider, SelectField, StateError, SubmitButton, useScopedAction } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { ACCOUNT_TYPES, userCreatableSubtypes, type AccountType } from "@/modules/ledger/client";
import { createAccountAction } from "./actions";

const isAccountType = (value: string | undefined): value is AccountType => (ACCOUNT_TYPES as readonly string[]).includes(value ?? "");

export function AccountForm({ companyId }: { companyId: string }) {
  const t = useTranslations("accounts");
  const types = useTranslations("enums.accountType");
  const subtypes = useTranslations("enums.accountSubtype");
  const { state, formAction, scope } = useScopedAction(createAccountAction.bind(null, companyId));
  const v = scope.values ?? {};
  const [type, setType] = useState<AccountType>(isAccountType(v.type) ? v.type : "EXPENSE");
  const typeSelect = useRef<HTMLSelectElement>(null);
  return (
    <form
      action={formAction}
      // React resets the form once the action is done (to what was typed after a refusal, to the first values after a success):
      // the list of subtypes follows what the type box then shows.
      onReset={() => queueMicrotask(() => setType(isAccountType(typeSelect.current?.value) ? (typeSelect.current?.value as AccountType) : "EXPENSE"))}
      className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
    >
      <h2 className="text-lg font-semibold">{t("add")}</h2>
      <StateError state={state} />
      <FormScopeProvider scope={scope}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="code" label={t("code")} hint={t("codeHint")} autoComplete="off" />
          <div className="hidden sm:block" />
          <Field name="nameFr" label={t("nameFr")} autoComplete="off" />
          <Field name="nameEn" label={t("nameEn")} autoComplete="off" />
          <div>
            <label htmlFor="account-type" className="mb-1 block text-sm font-medium">
              {t("type")}
            </label>
            {/* Remounted with the returned type after a refusal: React keeps the first-render default of a <select> when the form resets. */}
            <select
              key={scope.attempt}
              ref={typeSelect}
              id="account-type"
              name="type"
              defaultValue={isAccountType(v.type) ? v.type : "EXPENSE"}
              onChange={(event) => setType(event.target.value as AccountType)}
              className={`w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}
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
          />
        </div>
        <Field name="description" label={t("description")} required={false} />
      </FormScopeProvider>
      <SubmitButton variant="primary">{t("create")}</SubmitButton>
    </form>
  );
}
