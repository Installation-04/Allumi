import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { getSupplierRefundPrintDocument } from "@/modules/payments";
import { formatMoney } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../../_lib";
import { validId } from "../../../achats/editor";
import { PrintButton } from "../../../factures/validees/[invoiceId]/imprimer/print-button";

export async function generateMetadata() { return { title: (await getTranslations("supplierRefundPrint"))("title") }; }

export default async function PrintPage({ params }: { params: Promise<{ companyId: string; paymentId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const { paymentId } = await params;
  if (!validId(paymentId)) notFound();
  const t = await getTranslations("supplierRefundPrint");
  const p = await getTranslations("supplierRefunds");
  const back = <Link className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`} href={`/c/${company.id}/remboursements-fournisseurs/${paymentId}`}>{t("back")}</Link>;
  let document;
  try { document = await getSupplierRefundPrintDocument(actor, paymentId); }
  catch (error) {
    if (!(error instanceof AppError) || error.key !== "supplierRefunds.printLimit") throw error;
    return <section className="space-y-4">{back}<p role="alert">{(await getTranslations("errors"))(error.key)}</p></section>;
  }
  if (!document) notFound();
  return <section className="invoice-print space-y-5">
    <div className="print-controls flex flex-wrap items-center gap-4">{back}<PrintButton /><p className="w-full text-sm">{t("hint")}</p></div>
    <article aria-label={t("copy")} className="invoice-paper max-w-4xl space-y-6 rounded border border-stone-300 bg-white p-4 text-stone-950 sm:p-8">
      <header className="flex flex-wrap justify-between gap-4"><div><p className="font-semibold">{t("copy")}</p><h1 className="break-words text-2xl font-semibold">{t("title")} {document.number}</h1></div><p>CAD</p></header>
      <p className="break-words"><span className="font-semibold">{t("company")}</span>: {company.name}</p>
      <p className="text-sm">{t("scope")}</p>
      {document.status === "VOID" && <div className="rounded border-2 border-red-700 p-4 font-bold text-red-800"><p>{t("voided")}</p>{document.voidDate && <p>{p("voidDate")}: {document.voidDate}</p>}</div>}
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        {([[p("supplier"), document.supplier || t("supplierUnavailable")], [p("date"), document.date], [t("status"), p(`statuses.${document.status}`)], [p("method"), p(`methods.${document.method}`)], ...(document.reference ? [[p("reference"), document.reference]] : [])]).map(([label,value]) => <div key={label} className="min-w-0 break-words"><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap">{value}</dd></div>)}
      </dl>
      <p className="invoice-totals flex flex-wrap justify-between gap-3 border-y border-stone-300 py-4 text-xl font-bold"><span>{t("originalAmount")}</span><span>{formatMoney(document.amountCents, locale)}</span></p>
      <section className="space-y-3"><h2 className="font-semibold">{p("allocations")}</h2>
        {document.origins.length ? <table className="w-full table-fixed text-xs sm:text-sm"><thead><tr className="border-b-2 border-stone-400 text-left"><th className="w-[28%] break-words py-3 pr-2">{t("credit")}</th><th className="w-[24%] break-words px-1">{t("applied")}</th><th className="w-[24%] break-words px-1">{t("released")}</th><th className="w-[24%] break-words px-1 text-right">{p("amount")}</th></tr></thead><tbody>{document.origins.map((row,index) => <tr key={index} className="border-b border-stone-200 align-top"><td className="break-words py-3 pr-2">{row.number || t("sourceUnavailable")}</td><td className="break-words px-1 py-3">{row.appliedDate}</td><td className="break-words px-1 py-3">{row.unappliedDate ?? "—"}</td><td className="break-words px-1 py-3 text-right">{formatMoney(row.amountCents,locale)}</td></tr>)}</tbody></table> : <p>{p("originsEmpty")}</p>}
      </section>
    </article>
  </section>;
}
