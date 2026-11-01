import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getBill, getCreditDraft, creditAmount } from "@/modules/purchases";
import { todayIso, formatMoney } from "@/modules/ledger";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../_lib";
import { validId } from "../achats/editor";
import { saveCreditAction } from "./actions";
export async function CreditEditor({ params, billId, id }: { params: Promise<{ companyId: string }>; billId?: string; id?: string }) {
  const { company, actor, locale } = await loadCompany(params);
  if (!can(company, "entry.post") || (id && !validId(id))) notFound();
  const draft = id ? await getCreditDraft(actor, id) : null;
  if (id && !draft) notFound();
  const sourceId = draft?.creditedDocumentId ?? billId;
  if (!sourceId || !validId(sourceId)) notFound();
  const bill = await getBill(actor, sourceId);
  if (!bill || bill.status !== "POSTED") notFound();
  const t = await getTranslations("supplierCredits");
  const date = todayIso() > bill.postingDate.toISOString().slice(0,10) ? todayIso() : bill.postingDate.toISOString().slice(0,10);
  return <section className="max-w-3xl space-y-5">
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/achats/validees/${bill.id}`}>{t("source", { number: bill.number ?? "" })}</Link>
    <h1 className="text-2xl font-semibold">{t(id ? "edit" : "new")}</h1><p>{t("intro")}</p><p>{t("amountHint")}</p>
    <ActionForm action={saveCreditAction.bind(null, company.id, bill.id, id ?? null)} label={t("save")}>
      <input type="hidden" name="revision" value={draft?.revision ?? ""} />
      <Field name="documentDate" label={t("date")} type="date" defaultValue={draft?.documentDate.toISOString().slice(0,10) ?? date} />
      <Field name="memo" label={t("reason")} defaultValue={draft?.memo ?? ""} />
      {bill.lines.map(line => <div key={line.id} className="rounded border p-4"><Field name={`amount-${line.id}`} label={line.description} hint={t("maximum", { amount: formatMoney(line.amountCents, locale) })} defaultValue={creditAmount(draft?.lines.find(l => l.position === line.position)?.amountCents ?? 0n)} /></div>)}
    </ActionForm>
  </section>;
}
