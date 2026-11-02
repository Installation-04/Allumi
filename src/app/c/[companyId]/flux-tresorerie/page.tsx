import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatMoney,listFiscalYears,todayIso } from "@/modules/ledger";
import { getCashMovements,CASH_FIGURES } from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { statementPeriod } from "@/app/_lib/report-period";
import { TABLE_CLASS,TH_CLASS,TD_CLASS } from "@/app/_components/table";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany,accountName } from "../_lib";
import { cashAccountId,cashPage } from "../_cash-report";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("cashReport"))("title")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {company,actor,locale}=await loadCompany(params,"ledger.read"),t=await getTranslations("cashReport");
 const q=await searchParams,years=await listFiscalYears(actor),period=statementPeriod(q,years,todayIso()),accountId=cashAccountId(q.compte);
 const report=await getCashMovements(actor,{...period,accountId,page:cashPage(q.page)}).catch(e=>{if(e instanceof AppError&&e.key==="reports.account")notFound();throw e;});
 const base=`/c/${company.id}/flux-tresorerie`,filters={du:period.from,au:period.to,compte:accountId??""},query=new URLSearchParams(filters);
 const url=(page:number)=>`${base}?${new URLSearchParams({...filters,page:String(page)})}`;
 const money=(n:bigint)=>formatMoney(n,locale),control=`min-h-11 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`,button=`inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`;
 return <section className="space-y-5"><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
  <form key={query.toString()} method="get" className="flex flex-wrap items-end gap-3">
   <div className="min-w-0"><label htmlFor="cash-account" className="mb-1 block text-sm">{t("account")}</label><select id="cash-account" name="compte" defaultValue={accountId??""} className={`${control} max-w-full`}><option value="">{t("all")}</option>{report.accounts.map(a=><option key={a.id} value={a.id}>{a.code} – {accountName(a,locale)}{a.isActive?"":` · ${t("inactive")}`}</option>)}</select></div>
   <label><span className="mb-1 block text-sm">{t("from")}</span><input type="date" name="du" defaultValue={period.from} required className={control}/></label><label><span className="mb-1 block text-sm">{t("to")}</span><input type="date" name="au" defaultValue={period.to} required className={control}/></label><button className={button}>{t("apply")}</button><a className={button} href={`${base}/export?${query}`}>{t("export")}</a>
  </form>
  {years.length>0&&<p className="flex flex-wrap items-center gap-2 text-sm">{years.map(y=><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} key={y.id} href={`${base}?${new URLSearchParams({...filters,du:y.start,au:y.end})}`}>{y.start} → {y.end}</Link>)}</p>}
  <p role="status" className="text-sm">{t("period",period)}</p>
  <details className="rounded border border-stone-300 p-3 text-sm dark:border-stone-700"><summary className={`inline-flex min-h-11 cursor-pointer items-center rounded underline ${FOCUS}`}>{t("rulesTitle")}</summary><div className="space-y-2"><p>{t("scope")}</p><p>{t("rules")}</p><p>{t("limits")}</p></div></details>
  <h2 className="text-lg font-semibold">{t("summary")}</h2><dl className="grid max-w-xl grid-cols-[1fr_auto] gap-2 text-sm tabular-nums">{CASH_FIGURES.map(k=><div key={k} className="contents"><dt>{t(k)}</dt><dd className="text-right">{money(report.totals[k])}</dd></div>)}<dt className="font-semibold">{t("net")}</dt><dd className="text-right font-semibold">{money(report.totals.netCents)}</dd><dt>{t("control")}</dt><dd className="text-right">{money(report.totals.differenceCents)}</dd></dl>
  <p role="status" className={report.totals.differenceCents===0n?"text-sm text-green-800 dark:text-green-300":"text-sm font-semibold text-red-800 dark:text-red-300"}>{t(report.totals.differenceCents===0n?"agrees":"warning")}</p>
  {report.mixedEntryCount>0&&<p className="rounded border border-amber-500 p-3 text-sm">{t("mixedNotice",{count:report.mixedEntryCount})}</p>}
  <h2 className="text-lg font-semibold">{t("accounts")}</h2>{report.byAccount.length===0?<p>{t("emptyAccounts")}</p>:<div className="overflow-x-auto"><table className={TABLE_CLASS}><caption className="sr-only">{t("accounts")}</caption><thead><tr>{[t("account"),...CASH_FIGURES.map(k=>t(k))].map(label=><th scope="col" key={label} className={TH_CLASS}>{label}</th>)}</tr></thead><tbody>{report.byAccount.map(a=><tr key={a.id}><th scope="row" className={`${TD_CLASS} min-w-44 text-left font-normal`}><Link className={`underline ${FOCUS}`} href={`/c/${company.id}/grand-livre?${new URLSearchParams({compte:a.id,du:period.from,au:period.to})}`}>{a.code} – {accountName(a,locale)}</Link></th>{CASH_FIGURES.map(k=><td key={k} className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{money(a[k])}</td>)}</tr>)}</tbody></table></div>}
  <h2 className="text-lg font-semibold">{t("detail")}</h2><p className="text-sm">{t("count",{count:report.lineCount})}</p>
  {report.lineCount===0?<p>{t("empty")}</p>:<div className="overflow-x-auto"><table className={TABLE_CLASS}><caption className="sr-only">{t("detail")}</caption><thead><tr>{["date","entry","account","memo","kind","debit","credit"].map(k=><th key={k} scope="col" className={TH_CLASS}>{t(k as "memo")}</th>)}</tr></thead><tbody>{report.lines.map(l=><tr key={l.id}><td className={`${TD_CLASS} whitespace-nowrap`}>{l.date}</td><td className={TD_CLASS}><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/journal/${l.entryId}`}>{l.entryNumber}</Link></td><td className={TD_CLASS}>{l.accountCode}</td><td className={`${TD_CLASS} min-w-40 break-words`}>{l.memo}</td><td className={TD_CLASS}>{t(l.kind)}</td><td className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{money(l.debitCents)}</td><td className={`${TD_CLASS} whitespace-nowrap text-right tabular-nums`}>{money(l.creditCents)}</td></tr>)}</tbody></table></div>}
  {report.pageCount>1&&<nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">{report.page>1&&<Link className={button} href={url(report.page-1)}>{t("previous")}</Link>}<span>{t("page",{page:report.page,pages:report.pageCount})}</span>{report.page<report.pageCount&&<Link className={button} href={url(report.page+1)}>{t("next")}</Link>}</nav>}
 </section>;
}
