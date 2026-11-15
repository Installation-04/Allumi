import { PurchaseAttachments } from "../../../_attachments/panel";
import Link from "next/link";
import { SupplierRefundPanel } from "../../../remboursements-fournisseurs/panel";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierCreditOpenCents, getPostedCredit } from "@/modules/purchases";
import { can } from "@/modules/companies";
import { formatMoney, todayIso } from "@/modules/ledger";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../../../_lib";
import { validId } from "../../../achats/editor";
import { SupplierCreditApplicationsPanel } from "../../credit-applications-panel";
import { voidCreditAction } from "../../actions";

export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string; creditId: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const pt = await getTranslations("purchasePrint");
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const { creditId } = await params;
  if (!validId(creditId)) notFound();
  const credit = await getPostedCredit(actor, creditId, { includeApplications:false });
  if (!credit) notFound();
  const available = await getSupplierCreditOpenCents(actor, creditId);
  const t = await getTranslations("supplierCredits");
  const s = await getTranslations("purchases");
  return <section className="max-w-3xl space-y-5">
    <div className="flex flex-wrap items-center gap-3"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/credits-fournisseurs/valides`}>{t("postedList")}</Link>
    <Link className="inline-flex min-h-11 items-center rounded border px-4 underline" href={`/c/${company.id}/credits-fournisseurs/valides/${creditId}/imprimer`}>{pt("open")}</Link></div><h1 className="text-2xl font-semibold">{credit.number}</h1>
    <p className="font-semibold">{t(credit.status === "VOID" ? "voided" : "posted")}</p>
    {credit.status === "VOID" && <div className="space-y-2 rounded border border-amber-600 p-4">
      <p>{t("voidHint")}</p><p>{s("voidDate")}: {credit.voidEntry?.entryDate.toISOString().slice(0, 10)}</p>
      <p className="whitespace-pre-wrap break-words">{s("reason")}: {credit.voidReason}</p>
      <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${credit.voidEntryId}`}>{s("reversal")}</Link>
    </div>}
    <p>{t("postedHint")}</p>
    {credit.status === "POSTED" && <section className="space-y-2 rounded border border-stone-300 p-4 dark:border-stone-700" aria-label={t("availableTitle")}><h2 className="text-xl font-semibold tabular-nums">{t("available",{amount:formatMoney(available,locale)})}</h2><p className="text-sm">{t("availableHint")}</p></section>}
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/achats/validees/${credit.creditedDocumentId}`}>{t("source", { number: credit.creditedDocument?.number ?? "" })}</Link>
    <p>{t("date")}: {credit.documentDate.toISOString().slice(0, 10)} · {s("postingDate")}: {credit.postingDate.toISOString().slice(0, 10)}</p>
    <p className="whitespace-pre-wrap break-words">{t("reason")}: {credit.memo}</p>
    <ul className="space-y-3">{credit.lines.map(l => <li key={l.id} className="rounded border bg-white p-4 dark:bg-stone-900"><h2 className="font-semibold break-words">{l.description}</h2><p>{formatMoney(l.amountCents, locale)}</p></li>)}</ul>
    <div className="space-y-2 rounded border p-4"><p>{s("subtotal")}: {formatMoney(credit.subtotalCents, locale)}</p>{credit.taxes.map(tax => <p key={tax.id}>{tax.tax?.code || pt("taxLine")}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="text-xl font-semibold">{s("total")}: {formatMoney(credit.totalCents, locale)}</p></div>
    <SupplierCreditApplicationsPanel actor={actor} access={company} supplierCreditId={creditId} openCents={available} posted={credit.status === "POSTED"} locale={locale} query={await searchParams} />
    <SupplierRefundPanel actor={actor} access={company} supplierCreditId={creditId} openCents={available} locale={locale} posted={credit.status === "POSTED"} />
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${credit.journalEntryId}`}>{s("journal")}</Link>
    {credit.status === "POSTED" && can(company, "entry.post") && <details className="rounded border p-4">
      <summary className="min-h-11 cursor-pointer">{t("void")}</summary>
      <ActionForm action={voidCreditAction.bind(null, company.id, creditId)} label={t("void")}>
        <p>{t("voidWarning")}</p><Field name="voidDate" label={s("voidDate")} type="date" defaultValue={todayIso() > credit.postingDate.toISOString().slice(0, 10) ? todayIso() : credit.postingDate.toISOString().slice(0, 10)} />
        <Field name="reason" label={s("reason")} />
        <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmVoid")}</label>
      </ActionForm>
    </details>}
  <PurchaseAttachments actor={actor} access={company} documentId={creditId} /></section>;
}
