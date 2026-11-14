import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { previewEstimateEmail, getEstimateEmails } from "@/modules/sales";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../../../_lib";
import { validId } from "../../../factures/editor";
import { sendEstimateEmailAction } from "../../email-actions";

export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string; estimateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read"), { estimateId } = await params, query = await searchParams;
  if (!validId(estimateId) || Array.isArray(query.lang) || (query.lang !== undefined && !["fr-CA", "en"].includes(query.lang))) notFound();
  const language = (query.lang ?? locale) as "fr-CA" | "en", preview = await previewEstimateEmail(actor, estimateId, language);
  if (!preview) notFound();
  const { attempts, configured } = await getEstimateEmails(actor, estimateId), t = await getTranslations("estimateEmail"), e = await getTranslations("invoiceEmail");
  return <section className="max-w-4xl space-y-5 [overflow-wrap:anywhere]"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/devis/${estimateId}`}>{t("back")}</Link><h1 className="text-2xl font-semibold">{t("detail", { number: preview.number })}</h1><p>{t("intro")}</p>
    <form className="flex flex-wrap items-end gap-3"><div><label htmlFor="estimate-email-language">{e("language")}</label><select id="estimate-email-language" name="lang" defaultValue={language} className="mt-1 block min-h-11 rounded border bg-white px-3 dark:bg-stone-900"><option value="fr-CA">{e("french")}</option><option value="en">{e("english")}</option></select></div><button className="min-h-11 rounded border px-4">{t("refresh")}</button></form>
    <section className="space-y-3 rounded-lg border bg-white p-5 dark:bg-stone-900" aria-labelledby="estimate-email-preview"><h2 id="estimate-email-preview" className="font-semibold">{t("preview")}</h2><p>{t("subject")}: {preview.message.subject}</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{preview.message.text}</pre></section>
    <p>{t("publicContent")}</p>
    {can(company, "sales.manage") && !configured && <p role="status">{e("notConfigured")}</p>}
    {can(company, "sales.manage") && configured && <ActionForm action={sendEstimateEmailAction.bind(null, company.id, estimateId, randomUUID(), language)} label={t("send")} variant="primary"><Field name="recipient" label={e("recipient")} type="email" defaultValue={preview.recipient} autoComplete="email" /><label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label>{attempts.length > 0 && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="confirmResend" value="yes" required />{e("confirmResend")}</label>}</ActionForm>}
  </section>;
}
