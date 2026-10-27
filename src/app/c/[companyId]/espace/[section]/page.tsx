import { canAccessArea, visibleAreaRoutes } from "../../navigation-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadCompany } from "../../_lib";
import { AREAS, type Area } from "../../sections";
import { FOCUS } from "@/app/_components/focus";

export default async function AreaPage({ params }: { params: Promise<{ companyId: string; section: string }> }) {
  const { company } = await loadCompany(params);
  const { section } = await params;
  if (!Object.hasOwn(AREAS, section)) notFound();
  const area = section as Area;
  const t = await getTranslations("areas");
  if (!canAccessArea(company, area)) notFound();
  const routes = visibleAreaRoutes(company, area);
  return <section className="max-w-4xl space-y-6">
    <div><h1 className="text-2xl font-semibold">{t(`${area}.title`)}</h1><p className="mt-2 text-stone-600 dark:text-stone-400">{t(`${area}.description`)}</p></div>
    {routes.length > 0 && <div><h2 className="mb-3 font-semibold">{t("available")}</h2><div className="grid gap-3 sm:grid-cols-2">
      {routes.map((route) => <Link key={route} href={`/c/${company.id}/${route}`} className={`flex min-h-16 items-center justify-between rounded-lg border border-stone-200 bg-white p-4 text-brand-700 dark:border-stone-800 dark:bg-stone-900 dark:text-brand-500 ${FOCUS}`}><span>{t(`links.${route}`)}</span><span aria-hidden="true">→</span></Link>)}
    </div></div>}
    {area !== "comptabilite" && <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><h2 className="font-semibold">{t("planned")}</h2><p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{t(`${area}.planned`)}</p></div>}
    <Link href="https://github.com/Installation-04/Allumi/wiki/Fonctionnalites-et-limites" className={`inline-flex min-h-11 items-center rounded text-sm underline ${FOCUS}`}>{t("progress")}</Link>
  </section>;
}
