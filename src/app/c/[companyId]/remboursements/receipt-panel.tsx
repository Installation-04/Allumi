import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can, type AccessContext } from "@/modules/companies";
import { formatMoney, todayIso, type Locale } from "@/modules/ledger";
import { PAYMENT_METHODS, amountInput, listReceiptRefunds, listCustomerRefundAccounts } from "@/modules/payments";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName } from "../_lib";
import { recordReceiptRefundAction } from "./receipt-actions";

export async function ReceiptRefundPanel({ actor, access, receiptId, openCents, posted, hasActiveRefunds, locale, query }: {
  actor: { userId: string; companyId: string }; access: AccessContext; receiptId: string; openCents: bigint; posted: boolean; hasActiveRefunds: boolean; locale: Locale; query: Record<string, string | string[] | undefined>;
}) {
  const rawPage = query.page_remboursements;
  if (Array.isArray(rawPage) || (rawPage !== undefined && !/^[1-9]\d{0,4}$/.test(rawPage))) notFound();
  const t = await getTranslations("receiptRefunds");
  const r = await getTranslations("customerRefunds");
  const history = await listReceiptRefunds(actor, receiptId, Number(rawPage ?? "1"));
  const mayRecord = posted && openCents > 0n && can(access, "sales.manage") && can(access, "entry.post");
  const accounts = mayRecord ? await listCustomerRefundAccounts(actor) : [];
  const base = `/c/${actor.companyId}/encaissements/${receiptId}`;
  const href = (page: number) => `${base}?page_remboursements=${page}`;
  return <section className="space-y-4 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="receipt-refunds-title">
    <h2 id="receipt-refunds-title" className="font-semibold">{t("title")}</h2>
    <p className="text-sm">{t("intro")}</p>
    <p className="font-semibold tabular-nums">{t("available", { amount: formatMoney(openCents, locale) })}</p>
    {hasActiveRefunds && <p className="text-sm text-amber-800 dark:text-amber-300">{t("refundBlocked")}</p>}
    {!history.refunds.length ? <p>{t("empty")}</p> : <ul className="space-y-3">{history.refunds.map(refund => <li key={refund.id} className="space-y-1 rounded border border-stone-300 p-3 dark:border-stone-700">
      <Link href={`/c/${actor.companyId}/remboursements/${refund.paymentId}`} className={`inline-flex min-h-11 items-center break-words underline ${FOCUS}`}>{refund.number}</Link>
      <p className="text-sm">{refund.date} · {r(`statuses.${refund.status}`)}</p>
      <p className="tabular-nums">{t("portion", { amount: formatMoney(refund.offsetCents, locale) })}</p>
      {refund.amountCents !== refund.offsetCents && <p className="text-sm tabular-nums">{t("total", { amount: formatMoney(refund.amountCents, locale) })}</p>}
      <p className="text-sm">{t("originDate", { date: refund.appliedDate })}{refund.unappliedDate ? ` · ${r("released", { date: refund.unappliedDate })}` : ""}</p>
    </li>)}</ul>}
    {history.pageCount > 1 && <nav aria-label={t("historyPagination")} className="flex flex-wrap items-center gap-3">
      {history.page > 1 && <Link href={href(history.page - 1)} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{r("previous")}</Link>}
      <span className="text-sm">{r("page", { page: history.page, count: history.pageCount })}</span>
      {history.page < history.pageCount && <Link href={href(history.page + 1)} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{r("next")}</Link>}
    </nav>}
    {mayRecord && <details className="rounded border border-stone-300 p-4 dark:border-stone-700"><summary className={`min-h-11 cursor-pointer ${FOCUS}`}>{t("record")}</summary>
      <ActionForm action={recordReceiptRefundAction.bind(null, actor.companyId, receiptId, String(openCents), randomUUID())} label={r("submit")}>
        <Field name="amount" label={r("amountField")} hint={r("amountHint")} defaultValue={amountInput(openCents, locale)} inputMode="decimal" autoComplete="off" />
        <Field name="date" label={r("dateField")} type="date" defaultValue={todayIso()} />
        <SelectField name="accountId" label={r("accountField")} hint={r("accountHint")} options={accounts.map(account => ({ value: account.id, label: `${account.code} · ${accountName(account, locale)}` }))} />
        <SelectField name="method" label={r("methodField")} options={PAYMENT_METHODS.map(value => ({ value, label: r(`methods.${value}`) }))} defaultValue="EFT" />
        <Field name="reference" label={r("referenceField")} required={false} autoComplete="off" />
        <Field name="memo" label={r("memoField")} required={false} autoComplete="off" />
        <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label>
      </ActionForm>
    </details>}
  </section>;
}
