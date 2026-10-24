import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPostedCredit } from "@/modules/sales";
import { can } from "@/modules/companies";
import { formatMoney, todayIso } from "@/modules/ledger";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../../../_lib";
import { validId } from "../../../factures/editor";
import { voidCreditAction } from "../../actions";

export default async function Page({ params }: { params: Promise<{ companyId: string; creditId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const { creditId } = await params;
  if (!validId(creditId)) notFound();
  const credit = await getPostedCredit(actor, creditId);
  if (!credit) notFound();
  const t = await getTranslations("credits");
  const s = await getTranslations("sales");
  return <section className="max-w-3xl space-y-5">
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/avoirs/valides`}>{t("postedList")}</Link>
    <h1 className="text-2xl font-semibold">{credit.number}</h1>
    <p className="font-semibold">{t(credit.status === "VOID" ? "voided" : "posted")}</p>
    {credit.status === "VOID" && <div className="space-y-2 rounded border border-amber-600 p-4">
      <p>{t("voidHint")}</p><p>{s("voidDate")}: {credit.voidEntry?.entryDate.toISOString().slice(0, 10)}</p>
      <p className="whitespace-pre-wrap break-words">{s("reason")}: {credit.voidReason}</p>
      <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${credit.voidEntryId}`}>{s("reversal")}</Link>
    </div>}
    <p>{t("postedHint")}</p>
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/factures/validees/${credit.creditedDocumentId}`}>{t("source", { number: credit.creditedDocument?.number ?? "" })}</Link>
    <p>{t("date")}: {credit.issueDate.toISOString().slice(0, 10)} · {s("postingDate")}: {credit.postingDate.toISOString().slice(0, 10)}</p>
    <p className="whitespace-pre-wrap break-words">{t("reason")}: {credit.memo}</p>
    <ul className="space-y-3">{credit.lines.map(l => <li key={l.id} className="rounded border bg-white p-4 dark:bg-stone-900"><h2 className="font-semibold break-words">{l.description}</h2><p>{formatMoney(l.amountCents, locale)}</p></li>)}</ul>
    <div className="space-y-2 rounded border p-4"><p>{s("subtotal")}: {formatMoney(credit.subtotalCents, locale)}</p>{credit.taxes.map(tax => <p key={tax.id}>{tax.tax.code}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="text-xl font-semibold">{s("total")}: {formatMoney(credit.totalCents, locale)}</p></div>
    <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">{t("applications")}</h2>{credit.creditsApplied.map(a => <div key={a.id}>
      <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/factures/validees/${a.invoiceId}`}>{a.invoice.number}</Link>
      <p>{a.appliedDate.toISOString().slice(0, 10)} · {formatMoney(a.amountCents, locale)}</p>
      <p>{a.unappliedDate ? t("unapplied", { date: a.unappliedDate.toISOString().slice(0, 10) }) : t("active")}</p>
    </div>)}</section>
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${credit.journalEntryId}`}>{s("journal")}</Link>
    {credit.status === "POSTED" && can(company.role, "sales.manage") && <details className="rounded border p-4">
      <summary className="min-h-11 cursor-pointer">{t("void")}</summary>
      <ActionForm action={voidCreditAction.bind(null, company.id, creditId)} label={t("void")}>
        <p>{t("voidWarning")}</p><Field name="voidDate" label={s("voidDate")} type="date" defaultValue={todayIso() > credit.postingDate.toISOString().slice(0, 10) ? todayIso() : credit.postingDate.toISOString().slice(0, 10)} />
        <Field name="reason" label={s("reason")} />
        <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmVoid")}</label>
      </ActionForm>
    </details>}
  </section>;
}
