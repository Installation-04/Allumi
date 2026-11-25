import Link from "next/link";
import { can } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { getMileageLog, mileageFilters, mileageQuery, kilometers, MILEAGE_EXPORT_LIMIT } from "@/modules/mileage";
import { getTranslations } from "@/platform/i18n/server";
import { AppError } from "@/platform/errors";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TH_CLASS, TD_CLASS } from "@/app/_components/table";
import { loadCompany } from "../_lib";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("mileage"))("title")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {company,actor,locale}=await loadCompany(params,"mileage.read"),t=await getTranslations("mileage"),base=`/c/${company.id}/kilometrage`;
  let r;
  try{r=await getMileageLog(actor,mileageFilters(await searchParams,todayIso()));}
  catch(e){if(e instanceof RangeError||(e instanceof AppError&&['mileage.filters','mileage.limit'].includes(e.key)))return <section className="space-y-4"><h1 className="text-2xl font-semibold">{t('title')}</h1><p role="alert">{(await getTranslations('errors'))('mileage.filters')}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={base}>{t('reset')}</Link></section>;throw e;}
  const control=`min-h-11 max-w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`,button=`inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`,f=r.filters;
  return <section className="min-w-0 space-y-5 break-words"><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="max-w-3xl text-sm">{t('shared')}</p>
    <div className="flex flex-wrap gap-3">{can(company,'mileage.manage')&&<Link className={button} href={`${base}/nouveau`}>{t('create')}</Link>}{r.count<=MILEAGE_EXPORT_LIMIT?<a className={button} href={`${base}/export?${mileageQuery(f)}`}>{t('export')}</a>:<p role="status">{(await getTranslations('errors'))('mileage.exportLimit')}</p>}</div>
    <form method="get" className="flex flex-wrap items-end gap-3"><label><span className="mb-1 block text-sm">{t('from')}</span><input className={control} name="du" type="date" required defaultValue={f.from} max={todayIso()}/></label><label><span className="mb-1 block text-sm">{t('to')}</span><input className={control} name="au" type="date" required defaultValue={f.to} max={todayIso()}/></label><label className="min-w-0"><span className="mb-1 block text-sm">{t('vehicleFilter')}</span><input className={control} name="vehicule" type="search" defaultValue={f.vehicle} maxLength={80}/></label><div><label htmlFor="mileage-usage" className="mb-1 block text-sm">{t('usage')}</label><select id="mileage-usage" className={control} name="usage" defaultValue={f.usage}>{(['ALL','BUSINESS','PERSONAL'] as const).map(v=><option value={v} key={v}>{t(v)}</option>)}</select></div><button className={button}>{t('apply')}</button></form>
    <p className="text-sm">{t('period',{from:f.from,to:f.to,count:r.count})}</p>
    <dl className="grid gap-3 sm:grid-cols-3">{([['BUSINESS',r.businessMeters],['PERSONAL',r.personalMeters],['total',r.businessMeters+r.personalMeters]] as const).map(([key,value])=><div key={key} className="min-w-0 rounded border border-stone-300 p-4 dark:border-stone-700"><dt className="text-sm">{t(key)}</dt><dd className="mt-2 text-lg font-semibold tabular-nums">{kilometers(value,locale)} km</dd></div>)}</dl>
    {r.rows.length===0?<p>{t('empty')}</p>:<><ul className="space-y-3 sm:hidden">{r.rows.map(a=><li key={a.id} className="space-y-2 rounded border border-stone-300 p-4 dark:border-stone-700"><h2 className="font-semibold">{a.date} · {a.vehicle}</h2><p className="text-sm">{a.origin} → {a.destination}</p><p className="text-sm">{t(a.usage)} · {kilometers(a.distanceMeters,locale)} km</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}/${a.id}`}>{t('open')}</Link></li>)}</ul><div className="hidden overflow-x-auto sm:block"><table className={TABLE_CLASS}><caption className="sr-only">{t('title')}</caption><thead><tr>{(['date','vehicle','usage','route','distance','actions'] as const).map(k=><th scope="col" key={k} className={TH_CLASS}>{t(k)}</th>)}</tr></thead><tbody>{r.rows.map(a=><tr key={a.id}><th scope="row" className={`${TD_CLASS} text-left font-medium`}>{a.date}</th><td className={TD_CLASS}>{a.vehicle}</td><td className={TD_CLASS}>{t(a.usage)}</td><td className={TD_CLASS}>{a.origin} → {a.destination}</td><td className={`${TD_CLASS} tabular-nums`}>{kilometers(a.distanceMeters,locale)} km</td><td className={TD_CLASS}><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}/${a.id}`}>{t('open')}</Link></td></tr>)}</tbody></table></div></>}
    {r.pageCount>1&&<nav aria-label={t('pages')} className="flex flex-wrap items-center gap-3">{r.page>1&&<Link className={button} href={`${base}?${mileageQuery(f,r.page-1)}`}>{t('previous')}</Link>}<p>{t('page',{page:r.page,pages:r.pageCount})}</p>{r.page<r.pageCount&&<Link className={button} href={`${base}?${mileageQuery(f,r.page+1)}`}>{t('next')}</Link>}</nav>}
    <p className="max-w-3xl text-sm text-stone-600 dark:text-stone-400">{t('limits')}</p>
  </section>;
}
