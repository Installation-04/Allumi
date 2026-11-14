import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getInvoiceReminder, remindersMailConfigured } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../../_lib";
import { validId } from "../../factures/editor";
import { sendReminderAction } from "../actions";

export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string; invoiceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read"), { invoiceId } = await params, query = await searchParams;
  if (!can(company, "ledger.read") || !validId(invoiceId) || Array.isArray(query.lang) || (query.lang !== undefined && !["fr-CA", "en"].includes(query.lang))) notFound();
  const language = (query.lang ?? locale) as "fr-CA" | "en", preview = await getInvoiceReminder(actor, invoiceId, language);
  if (!preview) notFound();
  const t = await getTranslations("reminders"), e = await getTranslations("invoiceEmail"), configured = remindersMailConfigured();
  return <section className="max-w-3xl space-y-5 [overflow-wrap:anywhere]">
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/relances`}>{t("title")}</Link><h1 className="text-2xl font-semibold">{t("detail", { number: preview.number })}</h1>
    <p>{preview.customer}</p><p>{t("due")}: {preview.dueDate}</p><p className="font-semibold">{t("outstanding")}: {formatMoney(preview.openCents, locale)}</p><p>{t("checked", { date: preview.asOf })}</p><p className="rounded border border-amber-500 p-4">{t("review")}</p>
    <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/factures/validees/${invoiceId}`}>{t("invoice")}</Link>
    <form className="flex flex-wrap items-end gap-3"><div><label htmlFor="reminder-language">{e("language")}</label><select id="reminder-language" name="lang" defaultValue={language} className="mt-1 block min-h-11 rounded border bg-white px-3 dark:bg-stone-900"><option value="fr-CA">{e("french")}</option><option value="en">{e("english")}</option></select></div><button className="min-h-11 rounded border px-4">{t("refresh")}</button></form>
    <section className="space-y-3 rounded-lg border bg-white p-5 dark:bg-stone-900" aria-labelledby="reminder-preview"><h2 id="reminder-preview" className="font-semibold">{t("preview")}</h2><p>{t("subject")}: {preview.message.subject}</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{preview.message.text}</pre></section>
    <p>{t("manual")}</p>
    {can(company, "sales.manage") && !configured && <p role="status">{e("notConfigured")}</p>}
    {can(company, "sales.manage") && configured && <ActionForm action={sendReminderAction.bind(null, company.id, invoiceId, randomUUID(), language, String(preview.openCents), preview.asOf, preview.dueDate)} label={t("send")} variant="primary"><Field name="recipient" label={e("recipient")} type="email" defaultValue={preview.recipient} autoComplete="email" /><label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label>{preview.hasReminder && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="confirmResend" value="yes" required />{e("confirmResend")}</label>}</ActionForm>}
    <p className="text-sm">{t("historyHint")}</p>
  </section>;
}
