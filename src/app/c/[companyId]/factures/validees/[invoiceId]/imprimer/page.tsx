import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getInvoice } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../../../../_lib";
import { validId } from "../../../editor";
import { PrintButton } from "./print-button";

function address(value: unknown) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return ["name", "legalName", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "gstNumber", "qstNumber"].flatMap(key => typeof data[key] === "string" && data[key] ? [data[key] as string] : []);
}
export default async function InvoicePrintPage({ params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read");
  const { invoiceId } = await params;
  if (!validId(invoiceId)) notFound();
  const invoice = await getInvoice(actor, invoiceId);
  if (!invoice) notFound();
  const t = await getTranslations("sales");
  const p = await getTranslations("invoicePrint");
  return <section className="invoice-print space-y-5">
    <div className="print-controls flex flex-wrap items-center gap-4"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/factures/validees/${invoiceId}`}>{p("back")}</Link><PrintButton /><p className="w-full text-sm">{p("hint")}</p></div>
    <article className="invoice-paper max-w-4xl space-y-6 rounded border bg-white p-4 text-stone-950 sm:p-8">
      <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-semibold">{p("title")} {invoice.number}</h1><p>{t("date")}: {invoice.issueDate.toISOString().slice(0,10)}</p>{invoice.dueDate && <p>{t("due")}: {invoice.dueDate.toISOString().slice(0,10)}</p>}</div><p>CAD</p></header>
      {invoice.status === "VOID" && <div className="rounded border-2 border-red-700 p-4 font-bold text-red-800"><p>{t("voided")}</p><p>{t("voidDate")}: {invoice.voidEntry?.entryDate.toISOString().slice(0,10)}</p></div>}
      <div className="grid gap-6 sm:grid-cols-2">{([["issuer",invoice.issuerSnapshot],["billedTo",invoice.billingSnapshot]] as const).map(([key,value]) => <section key={key} className="min-w-0 break-words"><h2 className="font-semibold">{t(key)}</h2>{address(value).map((line,index)=><p key={index}>{line}</p>)}</section>)}</div>
      {invoice.reference && <p className="break-words">{t("reference")}: {invoice.reference}</p>}
      <table className="w-full table-fixed text-sm"><thead><tr className="border-b-2 border-stone-400 text-left"><th className="w-[44%] py-3">{p("description")}</th><th className="w-[14%] break-words px-1">{p("quantity")}</th><th className="w-[21%] break-words px-1 text-right">{p("unitPrice")}</th><th className="w-[21%] px-1 text-right">{p("amount")}</th></tr></thead><tbody>{invoice.lines.map(line=><tr key={line.id} className="border-b border-stone-200 align-top"><td className="break-words py-3 pr-2">{line.description}</td><td className="break-words px-1 py-3">{line.quantity.toString()}</td><td className="break-words px-1 py-3 text-right">{line.unitPrice.toString()}</td><td className="break-words px-1 py-3 text-right">{formatMoney(line.amountCents,locale)}</td></tr>)}</tbody></table>
      <div className="invoice-totals ml-auto max-w-sm space-y-2"><p className="flex justify-between gap-4"><span>{t("subtotal")}</span><span>{formatMoney(invoice.subtotalCents,locale)}</span></p>{invoice.taxes.map(tax=><p key={tax.id} className="flex justify-between gap-4"><span>{tax.tax.code}</span><span>{formatMoney(tax.amountCents,locale)}</span></p>)}<p className="flex justify-between gap-4 border-t pt-3 text-xl font-bold"><span>{t("total")}</span><span>{formatMoney(invoice.totalCents,locale)}</span></p></div>
      {invoice.memo && <p className="whitespace-pre-wrap break-words">{invoice.memo}</p>}
    </article>
  </section>;
}
