import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getInvoice, getCreditDraft, creditAmount } from "@/modules/sales";
import { todayIso, formatMoney } from "@/modules/ledger";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../_lib";
import { validId } from "../factures/editor";
import { saveCreditAction } from "./actions";
export async function CreditEditor({ params, invoiceId, id }: { params: Promise<{ companyId: string }>; invoiceId?: string; id?: string }) {
  const { company, actor, locale } = await loadCompany(params);
  if (!can(company.role, "sales.manage") || (id && !validId(id))) notFound();
  const draft = id ? await getCreditDraft(actor, id) : null;
  if (id && !draft) notFound();
  const sourceId = draft?.creditedDocumentId ?? invoiceId;
  if (!sourceId || !validId(sourceId)) notFound();
  const invoice = await getInvoice(actor, sourceId);
  if (!invoice || invoice.status !== "POSTED") notFound();
  const t = await getTranslations("credits");
  const date = todayIso() > invoice.postingDate.toISOString().slice(0,10) ? todayIso() : invoice.postingDate.toISOString().slice(0,10);
  return <section className="max-w-3xl space-y-5">
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/factures/validees/${invoice.id}`}>{t("source", { number: invoice.number ?? "" })}</Link>
    <h1 className="text-2xl font-semibold">{t(id ? "edit" : "new")}</h1><p>{t("intro")}</p><p>{t("amountHint")}</p>
    <ActionForm action={saveCreditAction.bind(null, company.id, invoice.id, id ?? null)} label={t("save")}>
      <input type="hidden" name="revision" value={draft?.revision ?? ""} />
      <Field name="issueDate" label={t("date")} type="date" defaultValue={draft?.issueDate.toISOString().slice(0,10) ?? date} />
      <Field name="memo" label={t("reason")} defaultValue={draft?.memo ?? ""} />
      {invoice.lines.map(line => <div key={line.id} className="rounded border p-4"><Field name={`amount-${line.id}`} label={line.description} hint={t("maximum", { amount: formatMoney(line.amountCents, locale) })} defaultValue={creditAmount(draft?.lines.find(l => l.position === line.position)?.amountCents ?? 0n)} /></div>)}
    </ActionForm>
  </section>;
}
