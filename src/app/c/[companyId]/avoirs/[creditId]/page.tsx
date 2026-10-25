import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { ActionForm, Field } from "@/app/_components/ui";
import { getCreditDraft } from "@/modules/sales";
import { formatMoney, todayIso } from "@/modules/ledger";
import { loadCompany } from "../../_lib";
import { validId } from "../../factures/editor";
import { deleteCreditAction, postCreditAction } from "../actions";
export default async function Page({ params }: { params: Promise<{ companyId: string; creditId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const { creditId } = await params;
  if (!validId(creditId)) notFound();
  const draft = await getCreditDraft(actor, creditId);
  if (!draft) notFound();
  const t = await getTranslations("credits");
  const s = await getTranslations("sales");
  return <section className="max-w-3xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/avoirs`}>{t("title")}</Link><h1 className="text-2xl font-semibold">{t("draft")}</h1><p>{t("intro")}</p><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/factures/validees/${draft.creditedDocumentId}`}>{t("source", { number: draft.creditedDocument?.number ?? "" })}</Link>{draft.creditedDocument?.status !== "POSTED" && <p role="status" className="rounded border border-amber-600 p-4">{t("sourceUnavailable")}</p>}<p>{t("date")}: {draft.issueDate.toISOString().slice(0,10)}</p><p className="whitespace-pre-wrap break-words">{t("reason")}: {draft.memo}</p><ul className="space-y-3">{draft.lines.map(line => <li key={line.id} className="rounded border bg-white p-4 dark:bg-stone-900"><h2 className="font-semibold break-words">{line.description}</h2><p>{formatMoney(line.amountCents, locale)}</p></li>)}</ul><div className="space-y-2 rounded border p-4"><p>{s("subtotal")}: {formatMoney(draft.subtotalCents, locale)}</p>{draft.taxes.map(tax => <p key={tax.id}>{tax.tax.code}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="text-xl font-semibold">{s("total")}: {formatMoney(draft.totalCents, locale)}</p></div>{can(company,"sales.manage") && <>{draft.creditedDocument?.status === "POSTED" && <details className="rounded border p-4"><summary className="min-h-11 cursor-pointer">{t("post")}</summary><ActionForm action={postCreditAction.bind(null,company.id,creditId,draft.revision)} label={t("post")}><p>{t("postWarning")}</p><Field name="postingDate" label={s("postingDate")} type="date" defaultValue={todayIso()>draft.issueDate.toISOString().slice(0,10)?todayIso():draft.issueDate.toISOString().slice(0,10)} /><label className="inline-flex min-h-11 items-center gap-3"><input name="confirm" type="checkbox" value="yes" required />{t("confirmPost")}</label></ActionForm></details>}{draft.creditedDocument?.status === "POSTED" && <Link className="inline-flex min-h-11 items-center rounded border px-4" href={`/c/${company.id}/avoirs/${creditId}/modifier`}>{t("edit")}</Link>}<details className="rounded border p-4"><summary className="min-h-11 cursor-pointer">{t("delete")}</summary><ActionForm action={deleteCreditAction.bind(null,company.id,creditId,draft.revision)} label={t("delete")}><label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmDelete")}</label></ActionForm></details></>}</section>;
}
