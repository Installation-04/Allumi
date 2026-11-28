import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { can } from "@/modules/companies";
import { projectFilters, projectQuery, listProjects } from "@/modules/projects";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TH_CLASS, TD_CLASS } from "@/app/_components/table";
import { loadCompany } from "../_lib";
export const dynamic = 'force-dynamic';
export async function generateMetadata() { return { title: (await getTranslations('projects'))('title') }; }
export default async function Page({ params, searchParams }: {
    params: Promise<{
        companyId: string;
    }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { company, actor } = await loadCompany(params, 'project.read'), t = await getTranslations('projects'), base = `/c/${company.id}/projets`, button = `inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`, control = `min-h-11 min-w-0 max-w-full rounded border bg-white px-3 text-base dark:bg-stone-900 ${FOCUS}`;
    let f;
    try {
        f = projectFilters(await searchParams);
    }
    catch {
        return <section className="space-y-4"><h1 className="text-2xl font-semibold">{t('title')}</h1><p role="alert">{t('invalidFilters')}</p><Link className={button} href={base}>{t('reset')}</Link></section>;
    }
    const r = await listProjects(actor, f);
    return <section className="min-w-0 space-y-5 break-words"><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="max-w-3xl">{t('hint')}</p><div className="flex flex-wrap gap-3">{can(company, 'project.manage') && <Link className={button} href={`${base}/nouveau`}>{t('create')}</Link>}<Link className={button} href={`/c/${company.id}/temps`}>{t('timeLog')}</Link></div><form method="get" className="flex flex-wrap items-end gap-3"><label className="min-w-0"><span className="mb-1 block text-sm">{t('search')}</span><input type="search" name="q" maxLength={120} defaultValue={f.q} className={control}/></label><label><span className="mb-1 block text-sm">{t('status')}</span><select name="statut" defaultValue={f.status} className={control}>{(['ACTIVE', 'ARCHIVED', 'ALL'] as const).map(x => <option key={x} value={x}>{t(x)}</option>)}</select></label><button className={button}>{t('apply')}</button></form><p>{t('count', { count: r.count })}</p>{r.rows.length ? <><ul className="space-y-3 sm:hidden">{r.rows.map(p => <li key={p.id} className="space-y-2 rounded border p-4"><Link className={`inline-flex min-h-11 items-center break-all font-semibold underline ${FOCUS}`} href={`${base}/${p.id}`}>{p.code}</Link><p className="[overflow-wrap:anywhere]">{p.name}</p><p className="text-sm">{t(p.status)}</p></li>)}</ul><div className="hidden overflow-x-auto sm:block"><table className={TABLE_CLASS}><caption className="sr-only">{t('title')}</caption><thead><tr>{(['code', 'name', 'status'] as const).map(k => <th scope="col" className={TH_CLASS} key={k}>{t(k)}</th>)}</tr></thead><tbody>{r.rows.map(p => <tr key={p.id}><th scope="row" className={`${TD_CLASS} text-left`}><Link className={`inline-flex min-h-11 items-center break-all underline ${FOCUS}`} href={`${base}/${p.id}`}>{p.code}</Link></th><td className={`${TD_CLASS} max-w-md break-words [overflow-wrap:anywhere]`}>{p.name}</td><td className={TD_CLASS}>{t(p.status)}</td></tr>)}</tbody></table></div></> : <p>{t('empty')}</p>}<div className="flex flex-wrap items-center gap-3"><p>{t('page', { page: r.page, pages: r.pages })}</p>{r.page > 1 && <Link className={button} href={`${base}?${projectQuery(f, r.page - 1)}`}>{t('previous')}</Link>}{r.page < r.pages && <Link className={button} href={`${base}?${projectQuery(f, r.page + 1)}`}>{t('next')}</Link>}</div></section>;
}
