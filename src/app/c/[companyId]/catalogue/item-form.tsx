"use client";
import { useTranslations } from "next-intl";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { saveItemAction } from "../taxes/actions";

type Option = { value: string; label: string };
export function ItemForm({ companyId, id = null, initial = {}, income, expense, codes }: { companyId: string; id?: string | null; initial?: Record<string, string>; income: Option[]; expense: Option[]; codes: Option[] }) {
  const t = useTranslations("catalog");
  const none = { value: "", label: t("none") };
  return <ActionForm action={saveItemAction.bind(null, companyId, id)} label={t("saveItem")} variant="primary"><div className="grid gap-4 sm:grid-cols-2">
    <Field name="name" label={t("name")} defaultValue={initial.name} /><Field name="code" label={t("code")} defaultValue={initial.code} required={false} />
    <Field name="description" label={t("description")} defaultValue={initial.description} required={false} />
    <Field name="unitPrice" label={t("unitPrice")} defaultValue={initial.unitPrice ?? "0"} hint={t("priceHint")} />
    <SelectField name="incomeAccountId" label={t("income")} defaultValue={initial.incomeAccountId} options={[none, ...income]} required={false} />
    <SelectField name="expenseAccountId" label={t("expense")} defaultValue={initial.expenseAccountId} options={[none, ...expense]} required={false} />
    <SelectField name="defaultTaxCodeId" label={t("taxCode")} defaultValue={initial.defaultTaxCodeId} options={[none, ...codes]} required={false} />
  </div></ActionForm>;
}
