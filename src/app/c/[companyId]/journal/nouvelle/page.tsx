import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { acceptsManualEntries, listAccounts, todayIso } from "@/modules/ledger";
import { accountName, loadCompany } from "../../_lib";
import { EntryForm } from "./entry-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("entry"))("title") };
}

export default async function NewEntryPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  if (!can(company.role, "entry.post")) redirect(`/c/${company.id}/journal`);
  const t = await getTranslations("entry");
  const accounts = (await listAccounts(actor)).filter(acceptsManualEntries);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <EntryForm
        companyId={company.id}
        locale={locale}
        today={todayIso()}
        accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} – ${accountName(account, locale)}` }))}
      />
    </section>
  );
}
