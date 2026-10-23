import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getInvoice } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../../../_lib";
import { validId } from "../../editor";
function snapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = value as Record<string, unknown>;
  return ["name", "legalName", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "gstNumber", "qstNumber"].flatMap(key => typeof data[key] === "string" && data[key] ? [data[key] as string] : []);
}
export default async function Page({ params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const { invoiceId } = await params;
  if (!validId(invoiceId)) notFound();
  const invoice = await getInvoice(actor, invoiceId);
  if (!invoice) notFound();
  const t = await getTranslations("sales");
  return <section className="max-w-4xl space-y-5"><Link href={`/c/${company.id}/factures/validees`} className="inline-flex min-h-11 items-center underline">{t("postedList")}</Link><h1 className="text-2xl font-semibold">{invoice.number}</h1><p className="font-semibold">{t("posted")}</p><p>{t("postedHint")}</p><p>{t("date")}: {invoice.issueDate.toISOString().slice(0, 10)} · {t("postingDate")}: {invoice.postingDate.toISOString().slice(0, 10)}</p><p>{t("due")}: {invoice.dueDate?.toISOString().slice(0, 10)}</p>{invoice.reference && <p className="break-words">{t("reference")}: {invoice.reference}</p>}<div className="grid gap-4 sm:grid-cols-2">{([["issuer", invoice.issuerSnapshot], ["billedTo", invoice.billingSnapshot]] as const).map(([key, value]) => <section key={key} className="rounded border p-4 break-words"><h2 className="font-semibold">{t(key)}</h2>{snapshot(value).map((text, i) => <p key={i}>{text}</p>)}</section>)}</div><ul className="space-y-3">{invoice.lines.map(line => <li key={line.id} className="rounded border bg-white p-4 dark:bg-stone-900"><h2 className="font-semibold break-words">{line.description}</h2><p>{line.quantity.toString()} × {line.unitPrice.toString()} CAD</p><p>{formatMoney(line.amountCents, locale)}</p></li>)}</ul><div className="space-y-2 rounded border p-4"><p>{t("subtotal")}: {formatMoney(invoice.subtotalCents, locale)}</p>{invoice.taxes.map(tax => <p key={tax.id}>{tax.tax.code}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="text-xl font-semibold">{t("total")}: {formatMoney(invoice.totalCents, locale)}</p></div>{invoice.memo && <p className="whitespace-pre-wrap break-words">{invoice.memo}</p>}<Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${invoice.journalEntryId}`}>{t("journal")}</Link></section>;
}
