import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm, Card } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { ledgerStatus } from "@/modules/ledger";
import { initializeLedgerAction } from "./actions";
import { loadCompany } from "./_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("dashboard"))("pageTitle") };
}

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor } = await loadCompany(params);
  const [t, tn, ts] = [await getTranslations("dashboard"), await getTranslations("nav"), await getTranslations("ledgerSetup")];
  const status = await ledgerStatus(actor);
  const base = `/c/${company.id}`;

  const sections = [
    { href: `${base}/journal`, title: tn("journal"), hint: t("journalHint") },
    { href: `${base}/comptes`, title: tn("accounts"), hint: t("accountsHint") },
    { href: `${base}/balance`, title: tn("trial"), hint: t("trialHint") },
    { href: `${base}/exercices`, title: tn("fiscal"), hint: t("fiscalHint") },
    ...(can(company.role, "audit.read") ? [{ href: `${base}/audit`, title: tn("audit"), hint: t("auditHint") }] : []),
  ];

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title", { company: company.name })}</h1>
        <p className="text-sm text-stone-700 dark:text-stone-300">{t("role", { role: t(`roles.${company.role}`) })}</p>
      </div>

      {status.initialized ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sections.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                className={`block h-full rounded-lg border border-stone-200 bg-white p-4 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800 ${FOCUS}`}
              >
                <span className="block font-semibold">{section.title}</span>
                <span className="mt-1 block text-sm text-stone-700 dark:text-stone-300">{section.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card title={ts("title")} headingLevel={2}>
          <p className="text-sm">{ts("intro")}</p>
          {can(company.role, "account.manage") ? <ActionForm action={initializeLedgerAction.bind(null, company.id)} label={ts("submit")} variant="primary" /> : <p className="text-sm">{ts("notAllowed")}</p>}
        </Card>
      )}

      <Link href="/compte/securite" className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
        {t("security")}
      </Link>
    </section>
  );
}
