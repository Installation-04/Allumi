import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getProfile } from "@/modules/auth";
import { ThemePicker } from "@/app/_components/theme-picker";
import { isTheme } from "@/app/_lib/theme";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../_lib";

export async function generateMetadata() {
  return { title: (await getTranslations("settingsPage"))("title") };
}

export default async function SettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor } = await loadCompany(params, "company.read");
  const t = await getTranslations("settingsPage");
  const profile = await getProfile(actor.userId);
  const theme = (await cookies()).get("allumi_theme")?.value;
  const base = `/c/${company.id}`;
  const sections: { key: "company" | "accounting" | "access" | "connections" | "server" | "application"; links: { href: string; key: "identity" | "taxSettings" | "accounts" | "periods" | "taxes" | "members" | "audit" | "security" | "integrations" | "serverAdmin" | "updates" | "help" }[] }[] = [
    { key: "company", links: [{ href: `${base}/entreprise`, key: "identity" as const }, { href: `${base}/entreprise#fiscal-settings`, key: "taxSettings" as const }] },
    { key: "accounting", links: [
      ...(can(company, "ledger.read") ? [{ href: `${base}/comptes`, key: "accounts" as const }, { href: `${base}/exercices`, key: "periods" as const }] : []),
      ...(can(company, "taxes.read") ? [{ href: `${base}/taxes`, key: "taxes" as const }] : []),
    ] },
    { key: "access", links: [
      ...(can(company, "members.manage") ? [{ href: `${base}/utilisateurs`, key: "members" as const }] : []),
      ...(can(company, "audit.read") ? [{ href: `${base}/audit`, key: "audit" as const }] : []),
      { href: "/compte/securite", key: "security" as const },
    ] },
    { key: "connections", links: can(company, "integration.manage") ? [{ href: `${base}/integrations`, key: "integrations" as const }] : [] },
    { key: "server", links: profile?.isInstanceAdmin || profile?.canManageServer ? [{ href: "/administration/serveur", key: "serverAdmin" as const }] : [] },
    { key: "application", links: [{ href: "/versions", key: "updates" as const }, { href: "https://github.com/Installation-04/Allumi/wiki", key: "help" as const }] },
  ];
  return <section className="max-w-6xl space-y-6">
    <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-2 text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sections.filter(section => section.links.length > 0).map(section => <section key={section.key} className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-lg font-semibold">{t(`${section.key}.title`)}</h2><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t(`${section.key}.description`)}</p>
        <ul className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">{section.links.map(link => <li key={link.key}><Link href={link.href} className={`flex min-h-12 items-center justify-between gap-3 rounded py-2 text-sm font-medium text-brand-700 dark:text-brand-500 ${FOCUS}`}><span>{t(`links.${link.key}`)}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
      </section>)}
      <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><h2 className="text-lg font-semibold">{t("preferences.title")}</h2><p className="text-sm text-stone-600 dark:text-stone-400">{t("preferences.description")}</p><ThemePicker value={isTheme(theme) ? theme : "system"} /><p className="text-sm text-stone-600 dark:text-stone-400">{t("preferences.language")}</p></section>
    </div>
  </section>;
}
