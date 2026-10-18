import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { getCompanyFor } from "@/modules/companies";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("dashboard"))("pageTitle") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireSession();
  if (!UUID.test(companyId)) notFound();
  // The database only answers if the user is an active member of this company.
  const company = await getCompanyFor(session.userId, companyId);
  if (!company) notFound();

  const t = await getTranslations("dashboard");
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title", { company: company.name })}</h1>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("role", { role: t(`roles.${company.role}`) })}</p>
      <p className="rounded-md border border-brand-500/40 bg-brand-50 p-4 text-sm text-stone-800 dark:bg-stone-900 dark:text-stone-200">{t("comingSoon")}</p>
      <Link href="/compte/securite" className="text-sm underline">
        {t("security")}
      </Link>
    </section>
  );
}
