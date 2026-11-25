import Link from "next/link";
import { AppError } from "@/platform/errors";
import { getTranslations } from "@/platform/i18n/server";
import { can } from "@/modules/companies";
import { listClientDocuments } from "@/modules/contracts";
import { loadCompany } from "../_lib";
import { FOCUS } from "@/app/_components/focus";
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<{q?:string|string[];page?:string|string[]}>}){
 const {company,actor}=await loadCompany(params,'sales.read'),t=await getTranslations('contracts'),q=await searchParams,base=`/c/${company.id}/contrats`;
 const valid=typeof q.q!=='object'&&typeof q.page!=='object'&&(q.page===undefined||/^[1-9]\d*$/.test(q.page));let report;
 try{if(!valid)throw new AppError("contracts.invalid");report=await listClientDocuments(actor,q.q as string|undefined,q.page?Number(q.page):1);}catch(error){if(!(error instanceof AppError&&error.key==="contracts.invalid"))throw error;return <section><h1 className="text-2xl font-semibold">{t('title')}</h1><p role="alert">{t('invalidFilters')}</p><Link href={base}>{t('reset')}</Link></section>;}
 return <section className="min-w-0 space-y-5 break-words"><h1 className="text-2xl font-semibold">{t('title')}</h1><p>{t('intro')}</p>{can(company,'sales.manage')&&<div className="flex flex-wrap gap-4"><Link className={`inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`} href={base+'/nouveau'}>{t('new')}</Link><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={base+'/modele'}>{t('template')}</Link></div>}<form method="get" className="flex flex-wrap gap-3"><label><span className="block text-sm">{t('search')}</span><input name="q" type="search" defaultValue={typeof q.q==='string'?q.q:''} className={`min-h-11 max-w-full rounded border bg-white px-3 dark:bg-stone-900 ${FOCUS}`}/></label><button className={`min-h-11 rounded border px-4 ${FOCUS}`}>{t('filter')}</button></form>
 {report.rows.length===0?<p>{t('empty')}</p>:<ul className="space-y-3">{report.rows.map(d=><li key={d.id} className="rounded border border-stone-300 p-4 dark:border-stone-700"><Link className={`inline-flex min-h-11 items-center font-semibold underline ${FOCUS}`} href={`${base}/${d.id}`}>{d.title}</Link><p>{t(d.kind)} · {d.customerName}</p><p>{t(d.revokedAt?'REVOKED':d.signedAt?'SIGNED':d.firstViewedAt?'VIEWED':d.status)}</p></li>)}</ul>}<nav className="flex flex-wrap gap-4" aria-label={t('pages')}>{report.page>1&&<Link className="inline-flex min-h-11 items-center underline" href={`${base}?${new URLSearchParams({q:typeof q.q==='string'?q.q:'',page:String(report.page-1)})}`}>{t('previous')}</Link>}{report.hasMore&&<Link className="inline-flex min-h-11 items-center underline" href={`${base}?${new URLSearchParams({q:typeof q.q==='string'?q.q:'',page:String(report.page+1)})}`}>{t('next')}</Link>}</nav></section>;
}
