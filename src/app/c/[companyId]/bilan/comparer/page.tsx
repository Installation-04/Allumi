import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatMoney,todayIso } from "@/modules/ledger";
import { getBalanceComparison,comparisonPercent,type ComparedAmount,type BalanceComparisonSection,type BalanceComparisonFigure } from "@/modules/reports";
import { TABLE_CLASS,TD_CLASS,TH_CLASS } from "@/app/_components/table";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { balanceComparisonDates } from "../../_balance-comparison-dates";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("balanceComparison"))("title")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {company,actor,locale}=await loadCompany(params,"ledger.read");const t=await getTranslations("statements"),c=await getTranslations("balanceComparison");
 const dates=balanceComparisonDates(await searchParams,todayIso()),r=await getBalanceComparison(actor,dates);
 const base=`/c/${company.id}/bilan`,query=new URLSearchParams({au:dates.asOf,au_ref:dates.referenceAsOf});
 const control=`min-h-11 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`,button=`inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`;
 const amounts=(a:ComparedAmount)=><>{[a.currentCents,a.referenceCents,a.differenceCents].map((n,i)=><td key={i} className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{formatMoney(n,locale)}</td>)}<td className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{a.percentHundredths===null?<span title={c("noPercent")}>—</span>:`${comparisonPercent(a.percentHundredths,locale)} %`}</td></>;
 const section=(key:BalanceComparisonSection)=>{const s=r.sections[key];if(!s.lines.length)return null;return <tbody key={key}><tr><th scope="colgroup" colSpan={5} className={TH_CLASS}>{t(key)}</th></tr>{s.lines.map(l=><tr key={l.accountId}><th scope="row" className={`${TD_CLASS} min-w-44 text-left font-normal`}><span className="font-mono">{l.code}</span> – {locale==="en"?l.nameEn:l.nameFr}</th>{amounts(l)}</tr>)}<tr><th scope="row" className={`${TD_CLASS} text-left`}>{t("total")}</th>{amounts(s.total)}</tr></tbody>;};
 const figure=(key:BalanceComparisonFigure)=><tbody><tr><th scope="row" className={`${TD_CLASS} min-w-44 text-left font-semibold`}>{t(key)}</th>{amounts(r.figures[key])}</tr></tbody>;
 return <section className="space-y-5"><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}?${new URLSearchParams({au:dates.asOf})}`}>{c("back")}</Link><h1 className="text-2xl font-semibold">{c("title")}</h1><p className="text-sm text-stone-600 dark:text-stone-400">{c("intro")}</p>
  <form key={query.toString()} method="get" className="flex flex-wrap items-end gap-3"><label><span className="mb-1 block text-sm">{c("current")}</span><input className={control} type="date" name="au" defaultValue={dates.asOf} required/></label><label><span className="mb-1 block text-sm">{c("reference")}</span><input className={control} type="date" name="au_ref" defaultValue={dates.referenceAsOf} required/></label><button className={button}>{c("apply")}</button><a className={button} href={`${base}/comparer/export?${query}`}>{c("export")}</a></form>
  <p className="text-sm" role="status">{c("dates",{current:dates.asOf,reference:dates.referenceAsOf})}</p><p className="rounded border border-stone-300 p-3 text-sm dark:border-stone-700">{c("rules")}</p>
  <dl className="grid max-w-xl grid-cols-[1fr_auto] gap-x-3 text-sm"><dt>{c("currentYear")}</dt><dd>{r.current.fiscalYearStart??c("none")}</dd><dt>{c("referenceYear")}</dt><dd>{r.reference.fiscalYearStart??c("none")}</dd></dl>
  {(!r.current.fiscalYearStart||!r.reference.fiscalYearStart)&&<p className="text-sm">{c("fallback")}</p>}
  <div className="space-y-2">{([["current",r.currentBalanced],["reference",r.referenceBalanced]] as const).map(([key,balanced])=><p role="status" key={key} className={balanced?"text-sm text-green-800 dark:text-green-300":"text-sm font-semibold text-red-800 dark:text-red-300"}>{c(balanced?"balanced":"unbalanced",{date:key==="current"?dates.asOf:dates.referenceAsOf})}</p>)}</div>
  <h2 className="text-lg font-semibold">{c("figures")}</h2><div className="overflow-x-auto"><table className={TABLE_CLASS}><caption className="sr-only">{c("title")}</caption><thead><tr>{[t("account"),c("current"),c("reference"),c("difference"),c("percent")].map(label=><th key={label} scope="col" className={`${TH_CLASS} whitespace-nowrap`}>{label}</th>)}</tr></thead>{section("currentAssets")}{section("fixedAssets")}{section("otherAssets")}{figure("totalAssets")}{section("currentLiabilities")}{section("longTermLiabilities")}{figure("totalLiabilities")}{section("equity")}{figure("priorEarnings")}{figure("currentEarnings")}{figure("totalEquity")}{figure("totalLiabilitiesAndEquity")}<tbody><tr><th scope="row" className={`${TD_CLASS} text-left`}>{c("control")}</th>{amounts(r.balanceGap)}</tr></tbody></table></div>
 </section>;
}
