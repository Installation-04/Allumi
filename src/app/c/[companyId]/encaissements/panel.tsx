import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can, type Role } from "@/modules/companies";
import { formatMoney, todayIso, type Locale } from "@/modules/ledger";
import { PAYMENT_METHODS, amountInput, listInvoicePayments, listReceiptAccounts, settlementStatus } from "@/modules/payments";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName } from "../_lib";
import { recordReceiptAction } from "./actions";

/** What a posted invoice shows about its payments: how settled it is, what was received, and the form to record one. */
export async function PaymentsPanel(props: { companyId: string; role: Role; actor: { userId: string; companyId: string }; invoiceId: string; totalCents: bigint; openCents: bigint; locale: Locale }) {
  const { companyId, role, actor, invoiceId, totalCents, openCents, locale } = props;
  const t = await getTranslations("payments");
  const payments = await listInvoicePayments(actor, invoiceId);
  const canRecord = can(role, "sales.manage") && openCents > 0n;
  const accounts = canRecord ? await listReceiptAccounts(actor) : [];
  return (
    <section className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="invoice-payments-title">
      <h2 id="invoice-payments-title" className="font-semibold">{t("invoiceTitle")}</h2>
      <p className="font-medium">{t(`settlement.${settlementStatus(totalCents, openCents)}`)}</p>
      {payments.length === 0 ? <p>{t("none")}</p> : (
        <ul className="space-y-1">
          {payments.map((payment) => (
            <li key={payment.allocationId} className="break-words">
              <Link href={`/c/${companyId}/encaissements/${payment.paymentId}`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{payment.number}</Link>
              {" · "}{payment.date}{" · "}{t(`methods.${payment.method}`)}{payment.reference ? ` · ${payment.reference}` : ""}{" · "}<span className="tabular-nums">{formatMoney(payment.amountCents, locale)}</span>
            </li>
          ))}
        </ul>
      )}
      {openCents <= 0n ? <p>{t("paidInFull")}</p> : null}
      {canRecord ? (
        <details className="rounded border border-stone-300 p-4 dark:border-stone-700">
          <summary className="min-h-11 cursor-pointer">{t("record")}</summary>
          <div className="mt-3">
            <ActionForm action={recordReceiptAction.bind(null, companyId, invoiceId, String(openCents))} label={t("submit")} variant="primary">
              <p className="text-sm">{t("recordHint")}</p>
              <Field name="amount" label={t("amountField")} hint={t("amountHint")} defaultValue={amountInput(openCents, locale)} inputMode="decimal" autoComplete="off" />
              <Field name="date" type="date" label={t("dateField")} defaultValue={todayIso()} />
              <SelectField name="accountId" label={t("accountField")} hint={t("accountHint")} options={accounts.map((account) => ({ value: account.id, label: `${account.code} · ${accountName(account, locale)}` }))} />
              <SelectField name="method" label={t("methodField")} options={PAYMENT_METHODS.map((value) => ({ value, label: t(`methods.${value}`) }))} defaultValue="EFT" />
              <Field name="reference" label={t("referenceField")} required={false} autoComplete="off" />
              <Field name="memo" label={t("memoField")} required={false} autoComplete="off" />
            </ActionForm>
          </div>
        </details>
      ) : null}
    </section>
  );
}
