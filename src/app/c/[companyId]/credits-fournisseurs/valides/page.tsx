import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listPostedCredits } from "@/modules/purchases";
import { formatMoney } from "@/modules/ledger";
import { loadCompany } from "../../_lib";
export default async function Page({params}:{params:Promise<{companyId:string}>}){
 const {company,actor,locale}=await loadCompany(params, "ledger.read");const t=await getTranslations("supplierCredits");const credits=await listPostedCredits(actor);
 return <section className="space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/credits-fournisseurs`}>{t("title")}</Link><h1 className="text-2xl font-semibold">{t("postedList")}</h1>{!credits.length&&<p>{t("postedEmpty")}</p>}{credits.length>100&&<p>{t("postedLimit")}</p>}<ul className="grid gap-3 lg:grid-cols-2">{credits.slice(0,100).map(c=><li key={c.id}><Link className="block space-y-2 rounded border bg-white p-5 dark:bg-stone-900" href={`/c/${company.id}/credits-fournisseurs/valides/${c.id}`}><h2 className="font-semibold">{c.number}</h2><p>{t(c.status==="VOID"?"voided":"posted")} · {c.postingDate.toISOString().slice(0,10)}</p><p className="text-xl font-semibold">{formatMoney(c.totalCents,locale)}</p></Link></li>)}</ul></section>;
}
