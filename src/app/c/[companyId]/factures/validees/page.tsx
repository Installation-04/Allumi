import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listInvoices } from "@/modules/sales";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../../_lib";
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const rows = await listInvoices(actor);
  const t = await getTranslations("sales");
  const base = `/c/${company.id}/factures`;
  return <section className="space-y-5"><Link href={base} className="inline-flex min-h-11 items-center underline">{t("back")}</Link><h1 className="text-2xl font-semibold">{t("postedList")}</h1>{rows.length > 100 && <p>{t("postedLimit")}</p>}<ul className="grid gap-3 lg:grid-cols-2">{rows.slice(0, 100).map(row => <li key={row.id}><Link href={`${base}/validees/${row.id}`} className="block space-y-2 rounded border border-stone-300 bg-white p-5 dark:border-stone-700 dark:bg-stone-900"><h2 className="font-semibold">{row.number}</h2><p>{t(row.status === "VOID" ? "voided" : "posted")}</p><p>{row.issueDate.toISOString().slice(0, 10)}</p><p>{formatMoney(row.totalCents, locale)}</p></Link></li>)}</ul></section>;
}
