import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getEstimate, getDraftOptions } from "@/modules/sales";
import { todayIso } from "@/modules/ledger";
import { Field } from "@/app/_components/ui";
import { loadCompany, accountName } from "../_lib";
import { DraftForm } from "../factures/form";
import { validId } from "../factures/editor";
import { saveEstimateAction } from "./actions";
export async function EstimateEditor({ params, id, copyId }: { params: Promise<{ companyId: string }>; id?: string; copyId?: string }) {
  const { company, actor, locale } = await loadCompany(params, "sales.manage");
  if (!(["contact.read", "ledger.read", "taxes.read"] as const).every(action => can(company, action)) || (id && !validId(id)) || (copyId && !validId(copyId))) notFound();
  const sourceId = id ?? copyId;
  const draft = sourceId ? await getEstimate(actor, sourceId) : null;
  if (sourceId && !draft || id && draft?.status !== "DRAFT") notFound();
  const options = await getDraftOptions(actor);
  const t = await getTranslations("estimates"), s = await getTranslations("sales");
  const initial = { contactId: options.contacts.some(c => c.id === draft?.contactId) ? draft?.contactId : "", issueDate: id && draft ? draft.issueDate : todayIso(), dueDate: id && draft ? draft.dueDate : todayIso(), reference: draft?.reference, memo: draft?.memo, revision: id ? draft?.revision : "", lines: draft?.lines.map(l => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: l.accountId, taxCodeId: l.taxCodeId, itemId: options.items.some(i => i.id === l.itemId) ? l.itemId : "" })) };
  return <section className="max-w-4xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/devis`}>{t("title")}</Link><h1 className="text-2xl font-semibold">{t(id ? "edit" : copyId ? "copy" : "new")}</h1><p>{t("intro")}</p>{options.truncated && <p role="status">{s("optionsLimit")}</p>}{(!options.contacts.length || !options.accounts.length || !options.codes.length) && <p role="status">{s("setupHint")}</p>}
    <DraftForm companyId={company.id} id={id} initial={initial} action={saveEstimateAction.bind(null, company.id, id ?? null)} dateLabel={t("date")} dueLabel={t("validUntil")} saveHint={t("saveHint")} memoLabel={t("memo")} contacts={options.contacts.map(c => ({ value: c.id, label: c.displayName }))} accounts={options.accounts.map(a => ({ value: a.id, label: `${a.code} — ${accountName(a, locale)}` }))} codes={options.codes.map(c => ({ value: c.id, label: c.code }))} items={options.items}><Field name="terms" label={t("terms")} defaultValue={draft?.terms} required={false} /></DraftForm>
  </section>;
}
