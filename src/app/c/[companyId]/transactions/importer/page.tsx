import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getSavedMapping, listBankAccounts, listImports } from "@/modules/banking";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { ImportForm } from "./import-form";

export async function generateMetadata() { return { title: (await getTranslations("banking"))("title") }; }

export default async function ImportPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "bank.read");
  if (!can(company, "bank.manage")) notFound();
  const t = await getTranslations("banking");
  const [accounts, recent] = await Promise.all([listBankAccounts(actor), listImports(actor)]);
  const saved = Object.fromEntries(await Promise.all(accounts.map(async (account) => [account.id, await getSavedMapping(actor, account.id)] as const)));
  const label = new Map(accounts.map((account) => [account.id, `${account.code} · ${accountName(account, locale)}`]));
  return (
    <section className="max-w-3xl space-y-5">
      <Link href={`/c/${company.id}/transactions`} className={`inline-flex min-h-11 items-center rounded text-sm underline ${FOCUS}`}>{t("back")}</Link>
      <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
      <ImportForm companyId={company.id} accounts={accounts.map((account) => ({ id: account.id, label: label.get(account.id) ?? account.code }))} saved={saved} />
      {recent.length > 0 ? (
        <section className="space-y-2" aria-labelledby="recent-imports">
          <h2 id="recent-imports" className="font-semibold">{t("recent")}</h2>
          <ul className="space-y-1 text-sm">
            {recent.map((file) => (
              <li key={file.id} className="break-words">{label.get(file.accountId) ?? ""} · {t("recentLine", { file: file.fileName, date: file.importedAt.toISOString().slice(0, 10), count: file.rowCount })}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
