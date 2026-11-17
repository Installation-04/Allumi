import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { can, type AccessContext } from "@/modules/companies";
import { formatMoney, todayIso, type Locale } from "@/modules/ledger";
import {
  PAYMENT_METHODS,
  amountInput,
  listCreditSupplierRefunds,
  listSupplierRefundAccounts,
} from "@/modules/payments";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { accountName } from "../_lib";
import { recordSupplierRefundAction } from "./actions";

export async function SupplierRefundPanel({
  actor,
  access,
  supplierCreditId,
  openCents,
  locale,
  posted,
}: {
  actor: { userId: string; companyId: string };
  access: AccessContext;
  supplierCreditId: string;
  openCents: bigint;
  locale: Locale;
  posted: boolean;
}) {
  const t = await getTranslations("supplierRefunds");
  const history = await listCreditSupplierRefunds(actor, supplierCreditId);
  const mayRecord =
    posted && openCents > 0n && can(access, "entry.post");
  const accounts = mayRecord ? await listSupplierRefundAccounts(actor) : [];
  return (
    <section aria-labelledby="supplier-refunds-title" className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700">
      <h2 id="supplier-refunds-title" className="font-semibold">{t("creditTitle")}</h2>
      <p className="text-sm">{t("recordHint")}</p>
      <ul>
        {history.payments.map((p) => (
          <li key={p.id}>
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={`/c/${actor.companyId}/remboursements-fournisseurs/${p.id}`}
            >
              {p.number} · {p.date} · {formatMoney(p.amountCents, locale)}
            </Link>
            {p.unappliedDate && (
              <p className="text-sm">
                {t("released", { date: p.unappliedDate })}
              </p>
            )}
          </li>
        ))}
      </ul>
      {history.hasMore && (
        <p>
          {t("historyLimit")}{" "}
          <Link
            className="underline"
            href={`/c/${actor.companyId}/remboursements-fournisseurs`}
          >
            {t("back")}
          </Link>
        </p>
      )}
      {mayRecord && (
        <details className="rounded border p-4">
          <summary className="min-h-11 cursor-pointer">{t("record")}</summary>
          <ActionForm
            action={recordSupplierRefundAction.bind(
              null,
              actor.companyId,
              supplierCreditId,
              String(openCents),
            )}
            label={t("submit")}
          >
            <Field
              name="amount"
              label={t("amountField")}
              defaultValue={amountInput(openCents, locale)}
              inputMode="decimal"
              autoComplete="off"
            />
            <Field
              name="date"
              label={t("dateField")}
              type="date"
              defaultValue={todayIso()}
            />
            <SelectField
              name="accountId"
              label={t("accountField")}
              hint={t("accountHint")}
              options={accounts.map((a) => ({
                value: a.id,
                label: `${a.code} · ${accountName(a, locale)}`,
              }))}
            />
            <SelectField
              name="method"
              label={t("methodField")}
              options={PAYMENT_METHODS.map((value) => ({
                value,
                label: t(`methods.${value}`),
              }))}
              defaultValue="EFT"
            />
            <Field
              name="reference"
              label={t("referenceField")}
              required={false}
            />
            <Field name="memo" label={t("memoField")} required={false} />
            <label className="inline-flex min-h-11 items-center gap-3">
              <input type="checkbox" name="confirm" value="yes" required />
              {t("confirmRecord")}
            </label>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
