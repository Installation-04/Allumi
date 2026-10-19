import Link from "next/link";
import { Header } from "@/app/_components/shell";
import { Icon } from "@/app/_components/icon";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { loadCompany } from "./_lib";
import { CompanyNav, type NavLink } from "./nav";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ companyId: string }> }) {
  const { company } = await loadCompany(params);
  const t = await getTranslations("nav");
  const td = await getTranslations("dashboard");
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
    <div className="company-workspace grid min-w-0 lg:grid-cols-[208px_minmax(0,1fr)]">
      <aside className="workspace-sidebar contents min-w-0 text-white lg:bg-[#34373b] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:self-start">
        <div className="hidden px-5 py-4 lg:block">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-white">a</span>Allumi
          </Link>
          {can(company.role, "entry.post") ? <Link href={`${base}/journal/nouvelle`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-stone-400 px-4 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:mt-5 lg:w-full"><Icon name="plus" />{td("create")}</Link> : null}
        </div>
        <CompanyNav links={links} label={t("label")} />
        <Link href="/compte/securite" className="hidden min-h-11 items-center gap-2 border-t border-white/15 px-5 py-4 text-sm text-stone-200 hover:bg-black/20 focus-visible:outline-2 focus-visible:outline-white lg:mt-auto lg:flex"><Icon name="audit" />{td("security")}</Link>
      </aside>
      <div className="min-w-0">
        <Header companyName={company.name} />
        <CompanyNav links={links} label={t("sections")} tabs />
        <div className="workspace-content min-w-0 px-4 py-6 sm:px-6 lg:px-7">{children}</div>
      </div>
    </div>
  );
}
