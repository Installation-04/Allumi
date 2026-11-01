import { randomUUID } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getInvoiceEmails } from "@/modules/sales";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { sendInvoiceEmailAction } from "./email-actions";

type Props = { actor: {userId:string;companyId:string}; access: Parameters<typeof can>[0]; documentId:string; billingSnapshot:unknown; locale:"fr-CA"|"en"; posted:boolean };
export async function InvoiceEmailPanel({actor,access,documentId,billingSnapshot,locale,posted}:Props) {
  const t=await getTranslations("invoiceEmail");
  const {configured,attempts}=await getInvoiceEmails(actor,documentId);
  const email=billingSnapshot && typeof billingSnapshot==="object" && !Array.isArray(billingSnapshot) && "email" in billingSnapshot && typeof billingSnapshot.email==="string" ? billingSnapshot.email : "";
  const canSend=posted && can(access,"sales.manage");
  return <section className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="invoice-email-title">
    <h2 id="invoice-email-title" className="font-semibold">{t("title")}</h2>
    <p className="text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
    {!configured && canSend && <p role="status" className="rounded border border-amber-600 p-3 text-sm">{t("notConfigured")}</p>}
    {attempts.length>0 ? <ul className="space-y-2">{attempts.slice(0,20).map(a=><li key={a.id} className="space-y-1 rounded border p-3 text-sm break-words"><p className="font-medium">{a.recipient}</p><p>{a.createdAt.toISOString().replace("T"," ").slice(0,16)} UTC · {t(a.locale==="en"?"english":"french")}</p><p>{t(`statuses.${a.status}` as "statuses.PENDING")}</p>{(a.status==="UNKNOWN" || a.status==="PENDING") && <p className="text-amber-800 dark:text-amber-300">{t("uncertainHint")}</p>}</li>)}</ul>:<p className="text-sm">{t("empty")}</p>}
    {attempts.length>20 && <p className="text-sm">{t("limit")}</p>}
    {canSend && configured && <details className="rounded border p-3"><summary className="min-h-11 cursor-pointer">{t(attempts.length?"resend":"send")}</summary><ActionForm action={sendInvoiceEmailAction.bind(null,actor.companyId,documentId,randomUUID())} label={t("submit")}>
      <Field name="recipient" label={t("recipient")} type="email" defaultValue={email} autoComplete="email" />
      <SelectField name="locale" label={t("language")} defaultValue={locale} options={[{value:"fr-CA",label:t("french")},{value:"en",label:t("english")}]} />
      <p className="text-sm">{t("contentHint")}</p>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label>
      {attempts.length>0 && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="confirmResend" value="yes" required />{t("confirmResend")}</label>}
    </ActionForm></details>}
  </section>;
}
