import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { getEstimateEmails } from "@/modules/sales";

export async function EstimateEmailPanel({ actor, estimateId, eligible }: { actor: { companyId: string; userId: string }; estimateId: string; eligible: boolean }) {
  const t = await getTranslations("estimateEmail"), e = await getTranslations("invoiceEmail"), { attempts } = await getEstimateEmails(actor, estimateId);
  return <section className="space-y-3 rounded-lg border p-4" aria-labelledby="estimate-email-history"><h2 id="estimate-email-history" className="font-semibold">{t("title")}</h2><p className="text-sm">{t("intro")}</p>
    {eligible && <Link className="inline-flex min-h-11 items-center rounded border px-4" href={`/c/${actor.companyId}/devis/${estimateId}/envoyer`}>{t("prepare")}</Link>}
    {!eligible && <p className="text-sm">{t("ineligible")}</p>}
    {!attempts.length ? <p>{e("empty")}</p> : <ul className="space-y-2">{attempts.slice(0, 20).map(a => <li key={a.id} className="space-y-1 break-words rounded border p-3 text-sm"><p className="font-medium">{a.recipient}</p><p>{a.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {e(a.locale === "en" ? "english" : "french")}</p><p>{e(`statuses.${a.status}` as "statuses.PENDING")}</p>{["PENDING", "UNKNOWN"].includes(a.status) && <p>{e("uncertainHint")}</p>}</li>)}</ul>}
    {attempts.length > 20 && <p>{e("limit")}</p>}
  </section>;
}
