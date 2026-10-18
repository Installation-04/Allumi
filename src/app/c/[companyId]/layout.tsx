import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { loadCompany } from "./_lib";
import { CompanyNav } from "./nav";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ companyId: string }> }) {
  const { company } = await loadCompany(params);
  const t = await getTranslations("nav");
  const base = `/c/${company.id}`;
  const links = [
    { href: base, label: t("overview") },
    { href: `${base}/journal`, label: t("journal") },
    { href: `${base}/comptes`, label: t("accounts") },
    { href: `${base}/balance`, label: t("trial") },
    { href: `${base}/exercices`, label: t("fiscal") },
    ...(can(company.role, "audit.read") ? [{ href: `${base}/audit`, label: t("audit") }] : []),
  ];
  return (
    <>
      <CompanyNav links={links} label={t("label")} />
      {children}
    </>
  );
}
