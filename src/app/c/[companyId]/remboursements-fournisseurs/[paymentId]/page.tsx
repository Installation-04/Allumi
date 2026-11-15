import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { formatMoney, todayIso } from "@/modules/ledger";
import { getSupplierRefund, listSupplierRefundOrigins } from "@/modules/payments";
import { ActionForm, Field } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { validId } from "../../achats/editor";
import { voidSupplierRefundAction } from "../actions";

export async function generateMetadata() { return { title: (await getTranslations("supplierRefunds"))("title") }; }

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ companyId: string; paymentId: string }>; searchParams: Promise<Record<string, string|string[]|undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const { paymentId } = await params;
  if (!validId(paymentId)) notFound();
  const payment = await getSupplierRefund(actor, paymentId);
  if (!payment) notFound();
  const query = await searchParams;
  if(query.page !== undefined && (typeof query.page !== "string" || !/^[1-9]\d{0,4}$/.test(query.page))) notFound();
  const history = await listSupplierRefundOrigins(actor,paymentId,Number(query.page ?? "1"));
  const t = await getTranslations("supplierRefunds");
  const sh = await getTranslations("supplierPaymentHistory");
  const base = `/c/${company.id}`;
  const rows: [string, React.ReactNode][] = [
    [t("supplier"), payment.supplier || sh("supplierUnavailable")],
    [t("amount"), <span key="a" className="tabular-nums">{formatMoney(payment.amountCents, locale)}</span>],
    [t("date"), payment.date],
    [t("method"), t(`methods.${payment.method}`)],
    [t("account"), `${payment.account.code} · ${accountName(payment.account, locale)}`],
    ...(payment.reference ? [[t("reference"), payment.reference] as [string, React.ReactNode]] : []),
    ...(payment.memo ? [[t("memo"), payment.memo] as [string, React.ReactNode]] : []),
  ];
  return (
    <section className="max-w-3xl space-y-5 break-words">
      <Link href={`${base}/remboursements-fournisseurs`} className={`inline-flex min-h-11 items-center rounded text-sm underline ${FOCUS}`}>{t("back")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("detail", { number: payment.number })}</h1>
        <span className="rounded-full bg-stone-200 px-3 py-1 text-sm dark:bg-stone-800">{t(`statuses.${payment.status}`)}</span>
      </div>
      <dl className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:grid-cols-2">
        {rows.map(([label, value]) => <div key={label}><dt className="text-sm text-stone-600 dark:text-stone-400">{label}</dt><dd className="whitespace-pre-wrap">{value}</dd></div>)}
      </dl>
      <section className="space-y-2" aria-labelledby="payment-allocations">
        <h2 id="payment-allocations" className="font-semibold">{t("allocations")}</h2>
        {history.total===0 && <p>{t("originsEmpty")}</p>}
        <ul className="space-y-1">
          {history.origins.map((allocation) => (
            <li key={allocation.id}>
              <Link href={`${base}/credits-fournisseurs/valides/${allocation.creditId}`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>
                {t("allocationLine", { amount: formatMoney(allocation.amountCents, locale), number: allocation.number })}
              </Link>
              {allocation.unappliedDate ? <span className="text-sm text-stone-600 dark:text-stone-400"> · {t("released", { date: allocation.unappliedDate })}</span> : null}
            </li>
          ))}
        </ul>
        <Link href={`${base}/journal/${payment.journalEntryId}`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{t("journalEntry")}</Link>
      </section>
      {history.pageCount>1 && <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">
        {history.page>1 && <Link className={`min-h-11 inline-flex items-center underline ${FOCUS}`} href={`${base}/remboursements-fournisseurs/${paymentId}?page=${history.page-1}`}>{t("previous")}</Link>}
        <span>{t("page",{page:history.page,count:history.pageCount})}</span>
        {history.page<history.pageCount && <Link className={`min-h-11 inline-flex items-center underline ${FOCUS}`} href={`${base}/remboursements-fournisseurs/${paymentId}?page=${history.page+1}`}>{t("next")}</Link>}
      </nav>}
      {payment.status === "VOID" ? (
        <div className="space-y-1 rounded border border-amber-600 p-4">
          <p>{t("voidedOn", { date: payment.voidDate ?? "" })}</p>
          <p className="whitespace-pre-wrap">{t("voidedReason", { reason: payment.voidReason ?? "" })}</p>
          {payment.voidEntryId ? <Link href={`${base}/journal/${payment.voidEntryId}`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{t("journalEntry")}</Link> : null}
        </div>
      ) : can(company, "entry.post") && can(company, "entry.reverse") ? (
        <details className="rounded border border-stone-300 p-4 dark:border-stone-700">
          <summary className="min-h-11 cursor-pointer">{t("voidTitle")}</summary>
          <div className="mt-3">
            <ActionForm action={voidSupplierRefundAction.bind(null, company.id, payment.id)} label={t("voidSubmit")}>
              <p className="text-sm">{t("voidWarning")}</p>
              <Field name="date" type="date" label={t("voidDate")} defaultValue={todayIso() > payment.date ? todayIso() : payment.date} />
              <Field name="reason" label={t("voidReason")} autoComplete="off" />
              <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmVoid")}</label>
            </ActionForm>
          </div>
        </details>
      ) : null}
    </section>
  );
}
