import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getDraft, getDraftOptions } from "@/modules/purchases";
import { todayIso } from "@/modules/ledger";
import { loadCompany, accountName } from "../_lib";
import { DraftForm } from "./form";
export const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export async function DraftEditor({ params, id }: { params: Promise<{ companyId: string }>; id?: string }) {
  const { company, actor, locale } = await loadCompany(params);
  if (!can(company, "entry.post") || (id && !validId(id))) notFound();
  const draft = id ? await getDraft(actor, id) : null;
  if (id && !draft) notFound();
  const options = await getDraftOptions(actor);
  const t = await getTranslations("purchases");
  return <section className="max-w-4xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/achats`}>{t("back")}</Link><h1 className="text-2xl font-semibold">{t(id ? "edit" : "new")}</h1><p>{t("intro")}</p>{options.truncated && <p role="status">{t("optionsLimit")}</p>}{(!options.contacts.length || !options.accounts.length || !options.codes.length) && <p role="status">{t("setupHint")}</p>}
    <DraftForm companyId={company.id} id={id} initial={draft ? { contactId: draft.contactId, documentDate: draft.documentDate, dueDate: draft.dueDate, supplierReference: draft.supplierReference, memo: draft.memo, revision: draft.revision, lines: draft.lines.map(line => ({ itemId: line.itemId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, accountId: line.accountId, taxCodeId: line.taxCodeId })) } : { documentDate: todayIso(), dueDate: todayIso() }} contacts={options.contacts.map(c => ({ value: c.id, label: c.displayName }))} accounts={options.accounts.map(a => ({ value: a.id, label: `${a.code} — ${accountName(a, locale)}` }))} codes={options.codes.map(c => ({ value: c.id, label: c.code }))} items={options.items} />
  </section>;
}
