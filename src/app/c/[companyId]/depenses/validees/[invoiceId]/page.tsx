import { PurchaseAttachments } from "../../../_attachments/panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { ActionForm, Field } from "@/app/_components/ui";
import { voidExpenseAction } from "../../actions";

import { getExpense } from "@/modules/purchases";
import { formatMoney, todayIso } from "@/modules/ledger";
import { accountName, loadCompany } from "../../../_lib";
import { validId } from "../../editor";
function snapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = value as Record<string, unknown>;
  return ["name", "legalName", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "gstNumber", "qstNumber"].flatMap(key => typeof data[key] === "string" && data[key] ? [data[key] as string] : []);
}
export default async function Page({ params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const { invoiceId } = await params;
  if (!validId(invoiceId)) notFound();
  const invoice = await getExpense(actor, invoiceId);
  if (!invoice) notFound();
  const t = await getTranslations("expenses");
  return <section className="max-w-4xl space-y-5"><Link href={`/c/${company.id}/depenses/validees`} className="inline-flex min-h-11 items-center underline">{t("postedList")}</Link><h1 className="text-2xl font-semibold">{invoice.number}</h1><p className="font-semibold">{t(invoice.status === "VOID" ? "voided" : "posted")}</p>{invoice.status === "VOID" && <div className="space-y-2 rounded border border-amber-600 p-4"><p>{t("voidHint")}</p><p>{t("voidDate")}: {invoice.voidEntry?.entryDate.toISOString().slice(0, 10)}</p><p className="whitespace-pre-wrap break-words">{t("reason")}: {invoice.voidReason}</p><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${invoice.voidEntryId}`}>{t("reversal")}</Link></div>}<p>{t("postedHint")}</p><p>{t("date")}: {invoice.documentDate.toISOString().slice(0, 10)} · {t("postingDate")}: {invoice.postingDate.toISOString().slice(0, 10)}</p><p>{t("paymentAccount")}: {invoice.paymentAccount?.code} — {invoice.paymentAccount ? accountName(invoice.paymentAccount, locale) : ""}</p><p>{t("paymentMethod")}: {t(`methods.${invoice.paymentMethod ?? "OTHER"}`)}</p>{invoice.supplierReference && <p className="break-words">{t("supplierReference")}: {invoice.supplierReference}</p>}<div className="grid gap-4 sm:grid-cols-2">{([["supplier", invoice.supplierSnapshot]] as const).map(([key, value]) => <section key={key} className="rounded border p-4 break-words"><h2 className="font-semibold">{t(key)}</h2>{snapshot(value).map((text, i) => <p key={i}>{text}</p>)}</section>)}</div><ul className="space-y-3">{invoice.lines.map(line => <li key={line.id} className="rounded border bg-white p-4 dark:bg-stone-900"><h2 className="font-semibold break-words">{line.description}</h2><p>{line.quantity.toString()} × {line.unitPrice.toString()} CAD</p><p>{formatMoney(line.amountCents, locale)}</p></li>)}</ul><div className="space-y-2 rounded border p-4"><p>{t("subtotal")}: {formatMoney(invoice.subtotalCents, locale)}</p>{invoice.taxes.map(tax => <p key={tax.id}>{tax.tax.code}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="text-xl font-semibold">{t("total")}: {formatMoney(invoice.totalCents, locale)}</p></div>{invoice.memo && <p className="whitespace-pre-wrap break-words">{invoice.memo}</p>}<Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${invoice.journalEntryId}`}>{t("journal")}</Link>{invoice.status === "POSTED" && can(company, "entry.post") && <details className="rounded border p-4"><summary className="min-h-11 cursor-pointer">{t("void")}</summary><ActionForm action={voidExpenseAction.bind(null, company.id, invoiceId)} label={t("void")}><p>{t("voidWarning")}</p><Field name="voidDate" label={t("voidDate")} type="date" defaultValue={todayIso() > invoice.postingDate.toISOString().slice(0, 10) ? todayIso() : invoice.postingDate.toISOString().slice(0, 10)} /><Field name="reason" label={t("reason")} /><label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmVoid")}</label></ActionForm></details>}<PurchaseAttachments actor={actor} access={company} documentId={invoiceId} /></section>;
}