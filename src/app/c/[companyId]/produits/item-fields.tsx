import { getTranslations } from "next-intl/server";
import { Field, SelectField, TextAreaField } from "@/app/_components/ui";
import type { ItemDto } from "@/modules/contacts";
import type { AccountDto, Locale } from "@/modules/ledger";
import { formatDecimal, UNIT_PRICE_SCALE, type TaxCodeDto } from "@/modules/taxes";

/** The boxes of an item, for the creation and the edition forms. They sit inside an ActionForm. */
export async function ItemFields({ item, accounts, taxCodes, locale }: { item?: ItemDto; accounts: AccountDto[]; taxCodes: TaxCodeDto[]; locale: Locale }) {
  const t = await getTranslations("items");
  const name = (account: AccountDto) => `${account.code} – ${locale === "en" ? account.nameEn : account.nameFr}`;
  const accountOptions = (type: "REVENUE" | "EXPENSE", current: string | null | undefined) => [
    { value: "", label: t("noAccount") },
    ...accounts.filter((account) => account.type === type && (account.isActive || account.id === current)).map((account) => ({ value: account.id, label: name(account) })),
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="code" label={t("code")} hint={t("codeHint")} defaultValue={item?.code ?? ""} required={false} autoComplete="off" />
        <div className="sm:col-span-2">
          <Field name="name" label={t("name")} defaultValue={item?.name} autoComplete="off" />
        </div>
      </div>
      <TextAreaField name="description" label={t("description")} defaultValue={item?.description ?? ""} />
      <Field
        name="unitPrice"
        label={t("unitPrice")}
        hint={t("unitPriceHint")}
        defaultValue={item?.unitPrice == null ? "" : formatDecimal(item.unitPrice, UNIT_PRICE_SCALE, locale, 2)}
        required={false}
        inputMode="decimal"
        autoComplete="off"
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField name="incomeAccountId" label={t("incomeAccount")} hint={t("incomeHint")} required={false} defaultValue={item?.incomeAccountId ?? ""} options={accountOptions("REVENUE", item?.incomeAccountId)} />
        <SelectField name="expenseAccountId" label={t("expenseAccount")} hint={t("expenseHint")} required={false} defaultValue={item?.expenseAccountId ?? ""} options={accountOptions("EXPENSE", item?.expenseAccountId)} />
        <SelectField
          name="defaultTaxCodeId"
          label={t("defaultTaxCode")}
          required={false}
          defaultValue={item?.defaultTaxCodeId ?? ""}
          options={[{ value: "", label: t("noTaxCode") }, ...taxCodes.filter((code) => code.isActive || code.id === item?.defaultTaxCodeId).map((code) => ({ value: code.id, label: `${code.code} – ${locale === "en" ? code.nameEn : code.nameFr}` }))]}
        />
      </div>
    </div>
  );
}
