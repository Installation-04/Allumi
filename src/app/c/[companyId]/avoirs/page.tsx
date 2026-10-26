import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listCreditDrafts } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../_lib";
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.read");
  const drafts = await listCreditDrafts(actor);
  const t = await getTranslations("credits");
  return <section className="space-y-5"><h1 className="text-2xl font-semibold">{t("title")}</h1><p>{t("intro")}</p><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/avoirs/valides`}>{t("postedList")}</Link><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/factures/validees`}>{t("chooseInvoice")}</Link>{drafts.length > 100 && <p>{t("limit")}</p>}{!drafts.length && <p>{t("empty")}</p>}<ul className="grid gap-3 lg:grid-cols-2">{drafts.slice(0,100).map(d => <li key={d.id}><Link className="block space-y-2 rounded border bg-white p-5 dark:bg-stone-900" href={`/c/${company.id}/avoirs/${d.id}`}><h2 className="font-semibold">{t("source", { number: d.creditedDocument?.number ?? "" })}</h2><p className="break-words">{d.memo}</p><p>{d.issueDate.toISOString().slice(0,10)} · {t("draft")}</p><p className="text-xl font-semibold">{formatMoney(d.totalCents, locale)}</p></Link></li>)}</ul></section>;
}
