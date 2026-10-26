import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getDraft } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../../_lib";
import { validId } from "../editor";
import { deleteDraftAction, postInvoiceAction } from "../actions";
export default async function Page({ params }: { params: Promise<{ companyId: string; draftId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read");
  const { draftId } = await params;
  if (!validId(draftId)) notFound();
  const draft = await getDraft(actor, draftId);
  if (!draft) notFound();
  const t = await getTranslations("sales");
  const base = `/c/${company.id}/factures`;
  return <section className="max-w-4xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={base}>{t("back")}</Link><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{draft.reference || t("draft")}</h1>{can(company, "sales.manage") && <Link className="inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-white" href={`${base}/${draftId}/modifier`}>{t("edit")}</Link>}</div><p className="font-semibold">{t("draft")}</p><p>{t("intro")}</p><p>{draft.customer} · {draft.issueDate} → {draft.dueDate}</p><p>{t("rounding")}: {draft.taxRounding === "PER_LINE" ? t("perLine") : t("perDocument")}</p><ul className="space-y-3">{draft.lines.map((line, i) => <li key={i} className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><h2 className="font-semibold break-words">{line.description}</h2><p className="tabular-nums">{line.quantity} × {line.unitPrice} CAD</p><p className="font-semibold">{formatMoney(line.amountCents, locale)}</p></li>)}</ul><div className="space-y-2 rounded-lg border p-4 tabular-nums"><p>{t("subtotal")}: {formatMoney(draft.subtotalCents, locale)}</p>{draft.taxes.map(tax => <p key={tax.code}>{tax.code}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="text-xl font-semibold">{t("total")}: {formatMoney(draft.totalCents, locale)}</p></div>{can(company, "sales.manage") && <details className="rounded border p-4"><summary className="min-h-11 cursor-pointer">{t("post")}</summary><ActionForm action={postInvoiceAction.bind(null, company.id, draftId, draft.revision)} label={t("post")} variant="primary"><p>{t("postHint")}</p><Field name="postingDate" label={t("postingDate")} type="date" defaultValue={draft.issueDate} /><label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmPost")}</label></ActionForm></details>}{draft.memo && <p className="whitespace-pre-wrap break-words">{draft.memo}</p>}{can(company, "sales.manage") && <details className="rounded border p-4"><summary className="min-h-11 cursor-pointer">{t("delete")}</summary><ActionForm action={deleteDraftAction.bind(null, company.id, draftId, draft.revision)} label={t("delete")}><label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmDelete")}</label></ActionForm></details>}</section>;
}
