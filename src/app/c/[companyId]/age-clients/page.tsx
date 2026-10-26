import { notFound } from "next/navigation";
import { can } from "@/modules/companies";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { balanceDay } from "@/app/_lib/report-period";
import { formatMoney, todayIso } from "@/modules/ledger";
import { AGE_BUCKETS, getReceivablesAging, type AgingItem } from "@/modules/reports";
import { loadCompany } from "../_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() { return { title: (await getTranslations("aging"))("title") }; }

export default async function ReceivablesAgingPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  if (!can(company, "sales.read")) notFound();
  const t = await getTranslations("aging");
  const asOf = balanceDay(await searchParams, todayIso());
  const aging = await getReceivablesAging(actor, { asOf });
  const base = `/c/${company.id}/age-clients`;
  const control = `min-h-11 rounded-md border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const button = `inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`;
  const link = `underline ${FOCUS}`;
  const money = (cents: bigint) => formatMoney(cents, locale);
  const amount = "whitespace-nowrap tabular-nums text-right";
  const headAmount = `${TH_CLASS} whitespace-nowrap text-right`;
  /** Where the document of an open item is read; a refund has no page of its own. */
  const href = (item: AgingItem): string | null => {
    if (item.kind === "INVOICE") return `/c/${company.id}/factures/validees/${item.id}`;
    if (item.kind === "CREDIT_NOTE") return `/c/${company.id}/avoirs/valides/${item.id}`;
    if (item.kind === "PAYMENT") return `/c/${company.id}/encaissements/${item.id}`;
    return null;
  };
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
      </div>
      <form key={asOf} method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block font-medium">{t("asOf")}</span><input type="date" name="au" defaultValue={asOf} required className={control} /></label>
        <button type="submit" className={button}>{t("apply")}</button>
        <a href={`${base}/export?${new URLSearchParams({ au: asOf })}`} className={button}>{t("export")}</a>
      </form>
      <p className="text-sm" role="status">{t("status", { date: asOf })}</p>
      {aging.customers.length === 0 ? <p>{t("empty")}</p> : (
        <>
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <caption className="sr-only">{t("title")} · {asOf}</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${TH_CLASS} min-w-40`}>{t("customer")}</th>
                  {AGE_BUCKETS.map((bucket) => <th key={bucket} scope="col" className={headAmount}>{t(bucket)}</th>)}
                  <th scope="col" className={headAmount}>{t("unapplied")}</th>
                  <th scope="col" className={headAmount}>{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                {aging.customers.map((customer) => (
                  <tr key={customer.contactId}>
                    <th scope="row" className={`${TD_CLASS} text-left font-normal`}><Link href={`#client-${customer.contactId}`} className={link}>{customer.contactName}</Link></th>
                    {AGE_BUCKETS.map((bucket) => <td key={bucket} className={`${TD_CLASS} ${amount}`}>{money(customer.buckets[bucket])}</td>)}
                    <td className={`${TD_CLASS} ${amount}`}>{money(customer.unappliedCents)}</td>
                    <td className={`${TD_CLASS} ${amount}`}>{money(customer.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className={`${TD_CLASS} text-left font-semibold`}>{t("total")}</th>
                  {AGE_BUCKETS.map((bucket) => <td key={bucket} className={`${TD_CLASS} ${amount} font-semibold`}>{money(aging.buckets[bucket])}</td>)}
                  <td className={`${TD_CLASS} ${amount} font-semibold`}>{money(aging.unappliedCents)}</td>
                  <td className={`${TD_CLASS} ${amount} font-semibold`}>{money(aging.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{t("detail")}</h2>
            {aging.customers.map((customer) => (
              <details key={customer.contactId} id={`client-${customer.contactId}`} className="rounded-md border border-stone-300 dark:border-stone-700">
                <summary className={`flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-4 px-4 py-2 ${FOCUS}`}>
                  <span className="font-medium break-words"><Link href={`/c/${company.id}/contacts/${customer.contactId}`} className={link}>{customer.contactName}</Link></span>
                  <span className="tabular-nums">{money(customer.totalCents)}</span>
                </summary>
                <div className="overflow-x-auto">
                  <table className={TABLE_CLASS}>
                    <caption className="sr-only">{t("detail")} · {customer.contactName}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={TH_CLASS}>{t("document")}</th>
                        <th scope="col" className={TH_CLASS}>{t("number")}</th>
                        <th scope="col" className={TH_CLASS}>{t("date")}</th>
                        <th scope="col" className={TH_CLASS}>{t("dueDate")}</th>
                        <th scope="col" className={headAmount}>{t("daysPastDue")}</th>
                        <th scope="col" className={headAmount}>{t("amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.items.map((item) => {
                        const target = href(item);
                        return (
                          <tr key={`${item.kind}-${item.id}`}>
                            <td className={TD_CLASS}>{t(`kinds.${item.kind}`)}</td>
                            <td className={`${TD_CLASS} font-mono`}>{target ? <Link href={target} className={link}>{item.number ?? "—"}</Link> : (item.number ?? "—")}</td>
                            <td className={`${TD_CLASS} tabular-nums`}>{item.date}</td>
                            <td className={`${TD_CLASS} tabular-nums`}>{item.dueDate ?? ""}</td>
                            <td className={`${TD_CLASS} ${amount}`}>{item.daysPastDue === null ? "" : item.daysPastDue < 0 ? t("notDue") : item.daysPastDue}</td>
                            <td className={`${TD_CLASS} ${amount}`}>{money(item.cents)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt>{t("ledgerBalance")}</dt><dd className="text-right">{money(aging.controlCents)}</dd>
        <dt>{t("difference")}</dt><dd className="text-right">{money(aging.differenceCents)}</dd>
      </dl>
      <p role="status" className={`text-sm ${aging.differenceCents === 0n ? "text-green-800 dark:text-green-300" : "font-semibold text-red-800 dark:text-red-300"}`}>
        {aging.differenceCents === 0n ? t("agrees") : t("differs", { amount: money(aging.differenceCents) })}
      </p>
    </section>
  );
}
