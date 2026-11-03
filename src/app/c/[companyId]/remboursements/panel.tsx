import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can, type AccessContext } from "@/modules/companies";
import { formatMoney, todayIso, type Locale } from "@/modules/ledger";
import {
  PAYMENT_METHODS,
  amountInput,
  listCreditRefunds,
  listCustomerRefundAccounts,
} from "@/modules/payments";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { accountName } from "../_lib";
import { recordCustomerRefundAction } from "./actions";

export async function CustomerRefundPanel({
  actor,
  access,
  creditNoteId,
  openCents,
  locale,
}: {
  actor: { userId: string; companyId: string };
  access: AccessContext;
  creditNoteId: string;
  openCents: bigint;
  locale: Locale;
}) {
  const t = await getTranslations("customerRefunds");
  const payments = await listCreditRefunds(actor, creditNoteId);
  const mayRecord =
    openCents > 0n && can(access, "sales.manage") && can(access, "entry.post");
  const accounts = mayRecord ? await listCustomerRefundAccounts(actor) : [];
  return (
    <section className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700">
      <h2 className="font-semibold">{t("creditTitle")}</h2>
      <p className="text-xl tabular-nums">
        {t("available", { amount: formatMoney(openCents, locale) })}
      </p>
      <p className="text-sm">{t("recordHint")}</p>
      <ul>
        {payments.map((p) => (
          <li key={p.allocationId}>
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={`/c/${actor.companyId}/remboursements/${p.paymentId}`}
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
      {payments.length === 200 && (
        <p>
          {t("historyLimit")}{" "}
          <Link
            className="underline"
            href={`/c/${actor.companyId}/remboursements`}
          >
            {t("back")}
          </Link>
        </p>
      )}
      {mayRecord && (
        <details className="rounded border p-4">
          <summary className="min-h-11 cursor-pointer">{t("record")}</summary>
          <ActionForm
            action={recordCustomerRefundAction.bind(
              null,
              actor.companyId,
              creditNoteId,
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
