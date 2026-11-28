import Link from 'next/link';
import { notFound,redirect } from 'next/navigation';
import { getEntryProjectAssignment,getProjectByCode } from '@/modules/projects';
import { formatMoney } from '@/modules/ledger';
import { getTranslations } from '@/platform/i18n/server';
import { AppError } from '@/platform/errors';
import { FOCUS } from '@/app/_components/focus';
import { ActionForm } from '@/app/_components/ui';
import { loadCompany } from '../../../_lib';
import { classifyEntryAction } from './actions';
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:(await getTranslations('entryProject'))('title')};}

export default async function Page({params,searchParams}:{params:Promise<{companyId:string;entryId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {actor,company,locale}=await loadCompany(params,'project.manage'),{entryId}=await params,t=await getTranslations('entryProject'),tf=await getTranslations('projectFinance'),te=await getTranslations('errors');
 const p=await getEntryProjectAssignment(actor,entryId).catch(e=>{if(e instanceof AppError&&e.key==='projectFinance.entryUnavailable')notFound();throw e;});
 const base=`/c/${company.id}/journal/${p.entryId}`;
 if(p.inherited)redirect(`${base}/projet`);
 const raw=(await searchParams).projet;let target,error:string|undefined;
 if(raw!==undefined&&raw!=='')try{
  if(typeof raw!=='string')throw new AppError('project.invalid');
  target=await getProjectByCode(actor,raw);
  if(target.status!=='ACTIVE')throw new AppError('project.archived');
 }catch(e){if(e instanceof AppError&&['project.invalid','project.notFound','project.archived'].includes(e.key)){error=te(e.key as 'project.invalid');target=undefined;}else throw e;}
 const button=`inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`,confirm=<label className="flex min-h-11 items-start gap-2 py-2"><input type="checkbox" name="confirmed" value="yes" required className={`mt-1 h-5 w-5 ${FOCUS}`}/><span>{target?tf('assignConfirm',{code:target.code}):tf('detachConfirm')}</span></label>;
 return <section className="min-w-0 max-w-3xl space-y-5 break-words">
  <h1 className="text-2xl font-semibold">{t('title')}</h1>
  <h2 className="text-xl font-semibold">{t('entry',{number:p.number,date:p.date})}</h2>
  <p className="text-sm">{tf('scope')}</p>
  <Link className={button} href={base}>{t('back')}</Link>
  <section aria-label={t('current')} className="space-y-3 rounded border p-4">
   <h2 className="font-semibold">{t('current')}</h2><p>{p.code?`${p.code} — ${p.name}`:t('unassigned')}</p>
   <dl className="grid gap-3 sm:grid-cols-2">{([['revenue',p.revenue],['expenses',p.expenses]] as const).map(([key,value])=><div key={key}><dt>{tf(key)}</dt><dd className="font-semibold">{formatMoney(value,locale)}</dd></div>)}</dl>
   {p.projectId&&<ActionForm action={classifyEntryAction.bind(null,company.id,p.entryId,p.revision,p.projectId,true)} label={tf('detach')}><label className="flex min-h-11 items-start gap-2 py-2"><input type="checkbox" name="confirmed" value="yes" required className={`mt-1 h-5 w-5 ${FOCUS}`}/><span>{tf('detachConfirm')}</span></label></ActionForm>}
  </section>
  <form method="get" className="space-y-3">
   <label className="block text-sm font-medium" htmlFor="project-code">{t('code')}</label>
   <input id="project-code" name="projet" type="text" maxLength={30} required defaultValue={typeof raw==='string'?raw:''} aria-describedby="project-code-hint" className={`min-h-11 min-w-0 w-full rounded border bg-white px-3 dark:bg-stone-900 ${FOCUS}`}/>
   <p id="project-code-hint" className="text-sm">{t('hint')}</p><button className={button}>{t('preview')}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {target&&<section aria-label={t('target')} className="space-y-3 rounded border p-4"><h2 className="font-semibold">{t('target')}</h2><p>{target.code} — {target.name}</p>{target.id===p.projectId?<p role="status">{t('same')}</p>:<ActionForm action={classifyEntryAction.bind(null,company.id,p.entryId,p.revision,target.id,false)} label={tf('assign')}>{confirm}</ActionForm>}</section>}
  <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/projets`}>{t('registry')}</Link>
  <p className="text-sm">{tf('limits')}</p>
 </section>;
}
