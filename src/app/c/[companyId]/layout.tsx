import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { loadCompany } from "./_lib";
import { CompanyNav, type NavLink } from "./nav";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ companyId: string }> }) {
  const { company } = await loadCompany(params);
  const t = await getTranslations("nav");
  const base = `/c/${company.id}`;
  const links: NavLink[] = [
    { href: base, label: t("overview"), icon: "overview" },
    { href: `${base}/journal`, label: t("journal"), icon: "journal" },
    { href: `${base}/comptes`, label: t("accounts"), icon: "accounts" },
    { href: `${base}/balance`, label: t("trial"), icon: "trial" },
    { href: `${base}/exercices`, label: t("fiscal"), icon: "fiscal" },
    ...(can(company.role, "audit.read") ? [{ href: `${base}/audit`, label: t("audit"), icon: "audit" as const }] : []),
  ];
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      <aside className="min-w-0 self-start rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900 lg:sticky lg:top-6">
        <div className="hidden border-b border-stone-100 px-5 py-6 dark:border-stone-800 lg:block">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">{t("workspace")}</p>
          <p className="mt-2 font-semibold">{company.name}</p>
        </div>
        <CompanyNav links={links} label={t("label")} />
      </aside>
      <div className="workspace-content min-w-0">{children}</div>
    </div>
  );
}
