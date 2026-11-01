import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listFiscalYears,todayIso,formatMoney } from "@/modules/ledger";
import { getTaxSummary,taxSummaryTotals } from "@/modules/reports";
import { statementPeriod } from "@/app/_lib/report-period";
import { searchText } from "@/app/_lib/search-params";
import { TABLE_CLASS,TD_CLASS,TH_CLASS } from "@/app/_components/table";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../_lib";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("taxSummary"))("title")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {company,actor,locale}=await loadCompany(params,"ledger.read");if(!can(company,"taxes.read"))notFound();
 const t=await getTranslations("taxSummary");const query=await searchParams;
 const {from,to}=statementPeriod(query,await listFiscalYears(actor),todayIso());
 const report=await getTaxSummary(actor,{from,to,page:Number(searchText(query.page))});const total=taxSummaryTotals(report.taxes);
 const base=`/c/${company.id}/sommaire-taxes`,url=(page:number)=>`${base}?${new URLSearchParams({du:from,au:to,page:String(page)})}`;
 const control=`min-h-11 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
 const button=`inline-flex min-h-11 items-center rounded border border-stone-300 px-4 dark:border-stone-700 ${FOCUS}`;
 const money=(n:bigint)=>formatMoney(n,locale);const keys=["collectedCents","recoverableCents","adjustmentCents","netCents","settlementCents","movementCents"] as const;
 const agrees=report.differenceCents===0n&&report.anomalyCount===0;
 return <section className="space-y-5">
  <h1 className="text-2xl font-semibold">{t("title")}</h1><p className="text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
  <form key={`${from}|${to}`} method="get" className="flex flex-wrap items-end gap-3">
   <label className="text-sm"><span className="mb-1 block">{t("from")}</span><input className={control} name="du" type="date" required defaultValue={from}/></label>
   <label className="text-sm"><span className="mb-1 block">{t("to")}</span><input className={control} name="au" type="date" required defaultValue={to}/></label>
   <button className={button}>{t("apply")}</button><a className={button} href={`${base}/export?${new URLSearchParams({du:from,au:to})}`}>{t("export")}</a>
  </form><p role="status" className="text-sm">{t("period",{from,to})}</p>
  <p className="rounded border border-stone-300 p-3 text-sm dark:border-stone-700">{t("scope")}</p>
  {report.taxes.length===0?<p>{t("empty")}</p>:<div className="overflow-x-auto"><table className={TABLE_CLASS}><caption className="sr-only">{t("title")}</caption><thead><tr>{["tax","collected","recoverable","adjustment","net","settlement","movement"].map(k=><th key={k} scope="col" className={`${TH_CLASS} whitespace-nowrap`}>{t(k as "tax")}</th>)}</tr></thead><tbody>{report.taxes.map(r=><tr key={r.id}><th scope="row" className={`${TD_CLASS} min-w-20 text-left font-normal`}><span className="font-medium">{r.code}</span><span className="block text-xs">{locale==="en"?r.nameEn:r.nameFr}</span></th>{keys.map(k=><td key={k} className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{money(r[k])}</td>)}</tr>)}</tbody><tfoot><tr><th scope="row" className={`${TD_CLASS} whitespace-nowrap text-left`}>{t("total")}</th>{keys.map(k=><td key={k} className={`${TD_CLASS} whitespace-nowrap text-right font-semibold tabular-nums`}>{money(total[k])}</td>)}</tr></tfoot></table></div>}
  <dl className="grid max-w-xl grid-cols-[1fr_auto] gap-x-4 text-sm"><dt>{t("control")}</dt><dd className="text-right tabular-nums">{money(report.controlCents)}</dd><dt>{t("difference")}</dt><dd className="text-right tabular-nums">{money(report.differenceCents)}</dd><dt>{t("anomalies")}</dt><dd className="text-right tabular-nums">{report.anomalyCount}</dd></dl>
  <p role="status" className={agrees?"text-sm text-green-800 dark:text-green-300":"text-sm font-semibold text-red-800 dark:text-red-300"}>{t(agrees?"agrees":"warning")}</p>
  {!agrees&&<Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/grand-livre?${new URLSearchParams({du:from,au:to})}`}>{t("reviewLedger")}</Link>}
  <h2 className="text-lg font-semibold">{t("detail")}</h2><p className="text-sm">{t("count",{count:report.lineCount})}</p>
  {report.lines.length>0&&<div className="overflow-x-auto"><table className={TABLE_CLASS}><caption className="sr-only">{t("detail")}</caption><thead><tr>{["date","entry","tax","box","account","memo","debit","credit"].map(k=><th key={k} scope="col" className={TH_CLASS}>{t(k as "tax")}</th>)}</tr></thead><tbody>{report.lines.map(l=><tr key={l.id}><td className={`${TD_CLASS} whitespace-nowrap`}>{l.date}</td><td className={TD_CLASS}><Link className={`underline ${FOCUS}`} href={`/c/${company.id}/journal/${l.entryId}`}>{l.entryNumber}</Link></td><td className={TD_CLASS}>{l.taxCode}</td><td className={TD_CLASS}>{t(`boxes.${l.box}`)}</td><td className={TD_CLASS}>{l.accountCode}</td><td className={`${TD_CLASS} min-w-40 break-words`}>{l.memo}</td><td className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{money(l.debitCents)}</td><td className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{money(l.creditCents)}</td></tr>)}</tbody></table></div>}
  {report.pageCount>1&&<nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">{report.page>1&&<Link className={button} href={url(report.page-1)}>{t("previous")}</Link>}<span>{t("page",{page:report.page,pages:report.pageCount})}</span>{report.page<report.pageCount&&<Link className={button} href={url(report.page+1)}>{t("next")}</Link>}</nav>}
 </section>;
}
