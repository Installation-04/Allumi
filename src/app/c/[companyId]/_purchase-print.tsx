import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { getPurchasePrintDocument } from "@/modules/purchases";
import { formatMoney } from "@/modules/ledger";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "./_lib";
import { validId } from "./achats/editor";
import { PrintButton } from "./factures/validees/[invoiceId]/imprimer/print-button";

export async function PurchasePrintPage({ params, documentId, kind }: {
  params: Promise<{ companyId: string }>;
  documentId: string;
  kind: "BILL" | "SUPPLIER_CREDIT";
}) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  if (!validId(documentId)) notFound();
  const document = await getPurchasePrintDocument(actor, documentId, kind);
  if (!document) notFound();
  const t = await getTranslations("purchasePrint");
  const p = await getTranslations("purchases");
  const line = await getTranslations("invoicePrint");
  const back = `/c/${company.id}/${kind === "BILL" ? "achats/validees" : "credits-fournisseurs/valides"}/${documentId}`;
  return <section className="invoice-print space-y-5">
    <div className="print-controls flex flex-wrap items-center gap-4">
      <Link className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`} href={back}>{t("back")}</Link>
      <PrintButton /><p className="w-full text-sm">{t("hint")}</p>
    </div>
    <article aria-label={t("copy")} className="invoice-paper max-w-4xl space-y-6 rounded border border-stone-300 bg-white p-4 text-stone-950 sm:p-8">
      <header className="flex flex-wrap justify-between gap-4">
        <div><p className="font-semibold">{t("copy")}</p><h1 className="break-words text-2xl font-semibold">{t(kind === "BILL" ? "bill" : "credit")} {document.number}</h1></div><p>CAD</p>
      </header>
      <p className="break-words text-sm"><span className="font-semibold">{t("company")}</span>: {company.name}</p>
      <p className="text-sm">{t("scope")}</p>
      {document.status === "VOID" && <div className="rounded border-2 border-red-700 p-4 font-bold text-red-800"><p>{t("voided")}</p>{document.voidDate && <p>{p("voidDate")}: {document.voidDate}</p>}</div>}
      <section className="min-w-0 break-words"><h2 className="font-semibold">{p("supplier")}</h2>{document.supplier.length ? document.supplier.map((value, index) => <p key={index}>{value}</p>) : <p>{t("supplierUnavailable")}</p>}</section>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {([[p("date"), document.date], [p("postingDate"), document.postingDate], ...(document.dueDate ? [[p("due"), document.dueDate]] : []), ...(document.reference ? [[p("supplierReference"), document.reference]] : []), ...(document.sourceNumber ? [[t("source"), document.sourceNumber]] : [])]).map(([label,value]) => <div key={label} className="min-w-0 break-words"><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <table className="w-full table-fixed text-xs sm:text-sm"><thead><tr className="border-b-2 border-stone-400 text-left"><th className="w-[43%] break-words py-3">{line("description")}</th><th className="w-[15%] break-words px-1">{line("quantity")}</th><th className="w-[21%] break-words px-1 text-right">{line("unitPrice")}</th><th className="w-[21%] break-words px-1 text-right">{line("amount")}</th></tr></thead>
        <tbody>{document.lines.map(row => <tr key={row.position} className="border-b border-stone-200 align-top"><td className="whitespace-pre-wrap break-words py-3 pr-2">{row.description}</td><td className="break-all px-1 py-3">{row.quantity}</td><td className="break-all px-1 py-3 text-right">{row.unitPrice}</td><td className="break-words px-1 py-3 text-right">{formatMoney(row.amountCents, locale)}</td></tr>)}</tbody>
      </table>
      <div className="invoice-totals ml-auto max-w-sm space-y-2">
        <p className="flex justify-between gap-4"><span>{p("subtotal")}</span><span>{formatMoney(document.subtotalCents, locale)}</span></p>
        {document.taxes.map((tax,index) => <p key={index} className="flex justify-between gap-4"><span>{tax.code || t("taxNumber", { number: index+1 })}</span><span>{formatMoney(tax.amountCents,locale)}</span></p>)}
        <p className="flex justify-between gap-4 border-t border-stone-300 pt-3 text-xl font-bold"><span>{p("total")}</span><span>{formatMoney(document.totalCents,locale)}</span></p>
      </div>
    </article>
  </section>;
}
