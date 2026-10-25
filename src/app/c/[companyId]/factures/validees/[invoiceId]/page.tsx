import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { ActionForm, Field } from "@/app/_components/ui";
import { voidInvoiceAction } from "../../actions";
import { getInvoice, listCreditDrafts, listPostedCredits, getInvoiceOpenCents } from "@/modules/sales";
import { formatMoney, todayIso } from "@/modules/ledger";
import { loadCompany } from "../../../_lib";
import { validId } from "../../editor";
import { PaymentsPanel } from "../../../encaissements/panel";
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
  const c = await getTranslations("credits");
  const credits = await listCreditDrafts(actor, invoiceId);
  const postedCredits = await listPostedCredits(actor, invoiceId);
  const openCents = await getInvoiceOpenCents(actor, invoiceId);
  return <section className="max-w-4xl space-y-5"><Link href={`/c/${company.id}/factures/validees`} className="inline-flex min-h-11 items-center underline">{t("postedList")}</Link><h1 className="text-2xl font-semibold">{invoice.number}</h1><p className="font-semibold">{t(invoice.status === "VOID" ? "voided" : "posted")}</p>{invoice.status === "VOID" && <div className="space-y-2 rounded border border-amber-600 p-4"><p>{t("voidHint")}</p><p>{t("voidDate")}: {invoice.voidEntry?.entryDate.toISOString().slice(0, 10)}</p><p className="whitespace-pre-wrap break-words">{t("reason")}: {invoice.voidReason}</p><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${invoice.voidEntryId}`}>{t("reversal")}</Link></div>}<p>{t("postedHint")}</p>{invoice.status === "POSTED" && <p className="text-xl font-semibold">{c("openBalance")}: {formatMoney(openCents ?? 0n,locale)}</p>}{invoice.status === "POSTED" && <PaymentsPanel companyId={company.id} role={company.role} actor={actor} invoiceId={invoiceId} totalCents={invoice.totalCents} openCents={openCents ?? 0n} locale={locale} />}{postedCredits.slice(0,100).map(credit=><Link key={credit.id} className="block min-h-11 underline" href={`/c/${company.id}/avoirs/valides/${credit.id}`}>{credit.number} · {formatMoney(credit.totalCents,locale)} · {c(credit.status === "VOID" ? "voided" : "posted")}</Link>)}<div className="space-y-2">{invoice.status === "POSTED" && can(company.role, "sales.manage") && <Link className="inline-flex min-h-11 items-center rounded border px-4" href={`/c/${company.id}/avoirs/nouveau?facture=${invoiceId}`}>{c("new")}</Link>}{credits.slice(0,100).map(credit => <Link key={credit.id} className="block min-h-11 break-words underline" href={`/c/${company.id}/avoirs/${credit.id}`}>{c("draft")}: {credit.memo} · {formatMoney(credit.totalCents, locale)}</Link>)}{credits.length > 100 && <Link className="block min-h-11 underline" href={`/c/${company.id}/avoirs`}>{c("limit")}</Link>}</div><p>{t("date")}: {invoice.issueDate.toISOString().slice(0, 10)} · {t("postingDate")}: {invoice.postingDate.toISOString().slice(0, 10)}</p><p>{t("due")}: {invoice.dueDate?.toISOString().slice(0, 10)}</p>{invoice.reference && <p className="break-words">{t("reference")}: {invoice.reference}</p>}<div className="grid gap-4 sm:grid-cols-2">{([["issuer", invoice.issuerSnapshot], ["billedTo", invoice.billingSnapshot]] as const).map(([key, value]) => <section key={key} className="rounded border p-4 break-words"><h2 className="font-semibold">{t(key)}</h2>{snapshot(value).map((text, i) => <p key={i}>{text}</p>)}</section>)}</div><ul className="space-y-3">{invoice.lines.map(line => <li key={line.id} className="rounded border bg-white p-4 dark:bg-stone-900"><h2 className="font-semibold break-words">{line.description}</h2><p>{line.quantity.toString()} × {line.unitPrice.toString()} CAD</p><p>{formatMoney(line.amountCents, locale)}</p></li>)}</ul><div className="space-y-2 rounded border p-4"><p>{t("subtotal")}: {formatMoney(invoice.subtotalCents, locale)}</p>{invoice.taxes.map(tax => <p key={tax.id}>{tax.tax.code}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="text-xl font-semibold">{t("total")}: {formatMoney(invoice.totalCents, locale)}</p></div>{invoice.memo && <p className="whitespace-pre-wrap break-words">{invoice.memo}</p>}<Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${invoice.journalEntryId}`}>{t("journal")}</Link>{invoice.status === "POSTED" && can(company.role, "sales.manage") && <details className="rounded border p-4"><summary className="min-h-11 cursor-pointer">{t("void")}</summary><ActionForm action={voidInvoiceAction.bind(null, company.id, invoiceId)} label={t("void")}><p>{t("voidWarning")}</p><Field name="voidDate" label={t("voidDate")} type="date" defaultValue={todayIso() > invoice.postingDate.toISOString().slice(0, 10) ? todayIso() : invoice.postingDate.toISOString().slice(0, 10)} /><Field name="reason" label={t("reason")} /><label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmVoid")}</label></ActionForm></details>}</section>;
}
