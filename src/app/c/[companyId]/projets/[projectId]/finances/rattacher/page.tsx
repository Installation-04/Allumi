import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from '@/platform/i18n/server';
import { getProject,previewProjectAssignment } from '@/modules/projects';
import { formatMoney } from '@/modules/ledger';
import { AppError } from '@/platform/errors';
import { ActionForm } from '@/app/_components/ui';
import { FOCUS } from '@/app/_components/focus';
import { loadCompany } from '../../../../_lib';
import { assignAction } from '../actions';
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:(await getTranslations('projectFinance'))('prepare')};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string;projectId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {company,actor,locale}=await loadCompany(params,'project.manage'),{projectId}=await params,t=await getTranslations('projectFinance'),base=`/c/${company.id}/projets/${projectId}/finances`,button=`inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`;
 const project=await getProject(actor,projectId).catch(e=>{if(e instanceof AppError&&e.key==='project.notFound')notFound();throw e;});const raw=(await searchParams).ecriture;let preview,error:string|undefined;
 if(raw!==undefined)try{if(typeof raw!=='string')throw new AppError('projectFinance.entryNumber');preview=await previewProjectAssignment(actor,raw);}catch(e){if(e instanceof AppError&&['projectFinance.entryNumber','projectFinance.entryUnavailable'].includes(e.key))error=(await getTranslations('errors'))(e.key as 'projectFinance.entryNumber');else throw e;}
 const detach=preview?.projectId===projectId;
 return <section className="max-w-3xl space-y-5 break-words"><h1 className="text-2xl font-semibold">{t('prepare')}</h1><h2 className="text-xl font-semibold">{project.code} — {project.name}</h2><p className="text-sm">{t('scope')}</p><Link className={button} href={base}>{t('backReport')}</Link><form method="get" className="flex flex-wrap items-end gap-3"><div className="min-w-0"><label htmlFor="entry-number" className="mb-1 block text-sm">{t('entryNumber')}</label><input id="entry-number" aria-describedby="entry-number-hint" type="text" inputMode="numeric" name="ecriture" required maxLength={19} defaultValue={typeof raw==='string'?raw:''} className={`min-h-11 min-w-0 max-w-full rounded border bg-white px-3 dark:bg-stone-900 ${FOCUS}`}/><span id="entry-number-hint" className="mt-1 block max-w-xl text-xs">{t('numberHint')}</span></div><button className={button}>{t('preview')}</button></form>{error&&<p role="alert">{error}</p>}{preview&&<section aria-label={t('previewTitle')} className="space-y-4 rounded border p-4"><h2 className="font-semibold">{t('previewTitle')}</h2><dl className="space-y-2"><div><dt>{t('entryNumber')}</dt><dd>{preview.number} · {preview.date}</dd></div><div><dt>{t('current')}</dt><dd>{preview.code?`${preview.code} — ${preview.name}`:t('unassigned')}</dd></div><div><dt>{t('revenue')}</dt><dd>{formatMoney(preview.revenue,locale)}</dd></div><div><dt>{t('expenses')}</dt><dd>{formatMoney(preview.expenses,locale)}</dd></div></dl>{(detach||project.status==='ACTIVE')?<ActionForm action={assignAction.bind(null,company.id,projectId,preview.entryId,preview.revision,detach)} label={detach?t('detach'):t('assign')}><label className="flex min-h-11 items-start gap-2 py-2"><input type="checkbox" name="confirmed" value="yes" required className={`mt-1 h-5 w-5 ${FOCUS}`}/><span>{detach?t('detachConfirm'):t('assignConfirm',{code:project.code})}</span></label></ActionForm>:<p role="status">{t('archived')}</p>}</section>}<p className="text-sm">{t('limits')}</p></section>;
}
