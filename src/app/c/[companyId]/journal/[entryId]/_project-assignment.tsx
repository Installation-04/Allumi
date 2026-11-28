import Link from 'next/link';
import { getEntryProjectAssignment } from '@/modules/projects';
import { getTranslations } from '@/platform/i18n/server';
import { AppError } from '@/platform/errors';
import { FOCUS } from '@/app/_components/focus';

export async function JournalProjectAssignment({actor,entryId,manage}:{actor:{userId:string;companyId:string};entryId:string;manage:boolean}){
 let p;try{p=await getEntryProjectAssignment(actor,entryId);}catch(e){if(e instanceof AppError&&e.key==='projectFinance.entryUnavailable')return null;throw e;}
 const t=await getTranslations('entryProject'),base=`/c/${actor.companyId}`,button=`inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`;
 return <section aria-label={t('section')} className="min-w-0 space-y-3 rounded-lg border p-4 break-words">
  <h2 className="text-lg font-semibold">{t('section')}</h2>
  <p>{p.code?`${p.code} — ${p.name}`:t('unassigned')}</p>
  {p.inherited&&<p className="text-sm">{t('inherited')}</p>}
  <div className="flex flex-wrap gap-3">
   {p.projectId&&<Link className={button} href={`${base}/projets/${p.projectId}`}>{t('viewProject')}</Link>}
   {p.inherited&&<Link className={button} href={`${base}/journal/${p.entryId}`}>{t('original')}</Link>}
   {manage&&<Link className={button} href={`${base}/journal/${p.entryId}/projet`}>{t(p.inherited?'classifyOriginal':p.projectId?'edit':'classify')}</Link>}
  </div>
 </section>;
}
