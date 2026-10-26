import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/_lib/session";
import { isSetUp } from "@/modules/auth";
import { listCompaniesFor } from "@/modules/companies";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("dashboard"))("pickCompany") };
}

export default async function HomePage() {
  if (!(await isSetUp())) redirect("/setup");
  const session = await getSession();
  if (!session) redirect("/connexion");
  if (session.mfaPending) redirect("/connexion/2fa");

  const companies = await listCompaniesFor(session.userId);
  if (companies.length === 1 && companies[0]) redirect(`/c/${companies[0].id}`);

  const t = await getTranslations("dashboard");
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{t("pickCompany")}</h1>
      {companies.length === 0 ? <p>{t("noCompany")}</p> : null}
      <ul className="space-y-2">
        {companies.map((company) => (
          <li key={company.id}>
            <Link href={`/c/${company.id}`} className="block rounded-md border border-stone-200 bg-white p-3 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800">
              {company.name}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/invitation" className="block min-h-11 underline">{(await getTranslations("members"))("join")}</Link>
      <Link href="/compte/securite" className="text-sm underline">
        {t("security")}
      </Link>
    </section>
  );
}
