import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { getProject } from "@/modules/projects";
import { can } from "@/modules/companies";
import { timeQuery, entryYearFilters } from "@/modules/time";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { ProjectForm } from "../form";
import { updateAction, archiveAction } from "../actions";
export const dynamic = 'force-dynamic';
export async function generateMetadata() { return { title: (await getTranslations('projects'))('detail') }; }
export default async function Page({ params }: {
    params: Promise<{
        companyId: string;
        projectId: string;
    }>;
}) {
    const { company, actor } = await loadCompany(params, 'project.read'), { projectId } = await params, t = await getTranslations('projects'), base = `/c/${company.id}/projets`, button = `inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`;
    const p = await getProject(actor, projectId).catch(e => { if (e instanceof AppError && e.key === 'project.notFound')
        notFound(); throw e; });
    const edit = can(company, 'project.manage'), active = p.status === 'ACTIVE';
    return <section className="max-w-3xl min-w-0 space-y-5 break-words [overflow-wrap:anywhere]"><h1 className="text-2xl font-semibold">{t('detail')}</h1><h2 className="text-xl font-semibold">{p.code} — {p.name}</h2><p>{t(p.status)}</p><p>{p.description || t('noDescription')}</p><p><span className="font-semibold">{t('customer')}: </span>{p.customerId !== undefined ? (p.hasCustomer ? p.customerName || t('customerUnavailable') : t('noCustomer')) : t('customerHidden')}</p><p className="text-sm">{t('snapshotHint')}</p><div className="flex flex-wrap gap-3"><Link className={button} href={base}>{t('back')}</Link><Link className={button} href={`${base}/${p.id}/finances`}>{t('financials')}</Link><Link className={button} href={`/c/${company.id}/temps?${timeQuery({ ...entryYearFilters(todayIso(), todayIso()), projectCode: p.code })}`}>{t('viewTime')}</Link>{edit && active && <Link className={button} href={`/c/${company.id}/temps/nouveau?${new URLSearchParams({ dossier: p.code })}`}>{t('addTime')}</Link>}</div>{edit && active && <details className="rounded border p-4"><summary className={`inline-flex min-h-11 cursor-pointer items-center font-semibold ${FOCUS}`}>{t('edit')}</summary><div className="mt-4"><ProjectForm key={p.revision} companyId={company.id} project={p} canContacts={can(company, 'contact.read')} action={updateAction.bind(null, company.id, p.id, p.revision)}/></div></details>}{edit && <details className="rounded border p-4"><summary className={`inline-flex min-h-11 cursor-pointer items-center font-semibold ${FOCUS}`}>{active ? t('archive') : t('reactivate')}</summary><ActionForm action={archiveAction.bind(null, company.id, p.id, p.revision, active)} label={active ? t('archive') : t('reactivate')}><label className="flex min-h-11 items-start gap-2 py-2"><input type="checkbox" name="confirmed" value="yes" required className={`mt-1 h-5 w-5 ${FOCUS}`}/><span>{active ? t('archiveConfirm') : t('reactivateConfirm')}</span></label></ActionForm></details>}<Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}/${p.id}`}>{t('reload')}</Link></section>;
}
