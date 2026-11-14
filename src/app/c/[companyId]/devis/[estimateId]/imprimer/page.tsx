import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getEstimate } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../../../_lib";
import { validId } from "../../../factures/editor";
import { PrintButton } from "../../../factures/validees/[invoiceId]/imprimer/print-button";
function address(value: Record<string, unknown> | null) {
  return ["name", "legalName", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "gstNumber", "qstNumber"].flatMap(key => typeof value?.[key] === "string" && value[key] ? [value[key] as string] : []);
}
export default async function Page({ params }: { params: Promise<{ companyId: string; estimateId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read");
  const { estimateId } = await params;
  if (!validId(estimateId)) notFound();
  const quote = await getEstimate(actor, estimateId);
  if (!quote) notFound();
  const t = await getTranslations("estimates"), s = await getTranslations("sales"), p = await getTranslations("invoicePrint");
  return <section className="invoice-print space-y-5"><div className="print-controls flex flex-wrap items-center gap-4"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/devis/${quote.id}`}>{t("back")}</Link><PrintButton /><p className="w-full text-sm">{p("hint")}</p></div><article className="invoice-paper max-w-4xl space-y-6 rounded border bg-white p-4 text-stone-950 sm:p-8 [overflow-wrap:anywhere]"><header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-semibold">{t("document")} {quote.number}</h1><p>{t("date")}: {quote.issueDate}</p><p>{t("validUntil")}: {quote.dueDate}</p></div><p>CAD</p></header><p className="rounded border-2 p-3 font-semibold">{t(`statuses.${quote.expired ? "EXPIRED" : quote.status}`)} · {t("notInvoice")}</p><div className="grid gap-6 sm:grid-cols-2">{([[s("issuer"), quote.issuerSnapshot ?? { name: company.name }], [s("customer"), quote.customerSnapshot ?? { name: quote.customer ?? t("restrictedCustomer") }]] as const).map(([label, value]) => <section key={label} className="min-w-0 break-words"><h2 className="font-semibold">{label}</h2>{address(value).map((line, i) => <p key={i}>{line}</p>)}</section>)}</div>{quote.reference && <p>{s("reference")}: {quote.reference}</p>}<table className="w-full table-fixed text-sm"><thead><tr className="border-b-2 border-stone-400 text-left"><th className="w-[44%] py-3">{p("description")}</th><th className="w-[14%] break-words px-1">{p("quantity")}</th><th className="w-[21%] break-words px-1 text-right">{p("unitPrice")}</th><th className="w-[21%] px-1 text-right">{p("amount")}</th></tr></thead><tbody>{quote.lines.map((l, i) => <tr key={i} className="border-b border-stone-200 align-top"><td className="break-words py-3 pr-2">{l.description}</td><td className="break-words px-1 py-3">{l.quantity}</td><td className="break-words px-1 py-3 text-right">{l.unitPrice}</td><td className="break-words px-1 py-3 text-right">{formatMoney(l.amountCents, locale)}</td></tr>)}</tbody></table><div className="invoice-totals ml-auto max-w-sm space-y-2"><p className="flex justify-between gap-4"><span>{s("subtotal")}</span><span>{formatMoney(quote.subtotalCents, locale)}</span></p>{quote.taxes.map(tax => <p key={tax.id} className="flex justify-between gap-4"><span>{tax.code}</span><span>{formatMoney(tax.amountCents, locale)}</span></p>)}<p className="flex justify-between gap-4 border-t pt-3 text-xl font-bold"><span>{s("total")}</span><span>{formatMoney(quote.totalCents, locale)}</span></p></div>{quote.terms && <section className="whitespace-pre-wrap break-words"><h2 className="font-semibold">{t("terms")}</h2><p>{quote.terms}</p></section>}</article></section>;
}
