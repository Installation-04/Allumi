import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { can } from "@/modules/companies";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { ProjectForm } from "../form";
import { createAction } from "../actions";
export const dynamic = 'force-dynamic';
export async function generateMetadata() { return { title: (await getTranslations('projects'))('create') }; }
export default async function Page({ params }: {
    params: Promise<{
        companyId: string;
    }>;
}) { const { company } = await loadCompany(params, 'project.manage'), t = await getTranslations('projects'); return <section className="max-w-2xl space-y-5"><h1 className="text-2xl font-semibold">{t('create')}</h1><p>{t('hint')}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/projets`}>{t('back')}</Link><ProjectForm companyId={company.id} canContacts={can(company, 'contact.read')} action={createAction.bind(null, company.id)}/></section>; }
