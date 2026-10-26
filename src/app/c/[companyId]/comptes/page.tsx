import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/_components/ui";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { listAccounts } from "@/modules/ledger";
import { accountName, loadCompany } from "../_lib";
import { deleteAccountAction, setAccountActiveAction } from "./actions";
import { AccountForm } from "./account-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts"))("title") };
}

export default async function AccountsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ inactifs?: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const showInactive = (await searchParams).inactifs === "1";
  const [t, types, subtypes] = [await getTranslations("accounts"), await getTranslations("enums.accountType"), await getTranslations("enums.accountSubtype")];
  const accounts = await listAccounts(actor, { includeInactive: showInactive });
  const manage = can(company, "account.manage");
  const base = `/c/${company.id}/comptes`;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("systemHint")}</p>
      <Link href={showInactive ? base : `${base}?inactifs=1`} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
        {showInactive ? t("hideInactive") : t("showInactive")}
      </Link>

      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <caption className="sr-only">{t("title")}</caption>
          <thead>
            <tr>
              <th scope="col" className={TH_CLASS}>{t("code")}</th>
              <th scope="col" className={TH_CLASS}>{t("name")}</th>
              <th scope="col" className={TH_CLASS}>{t("type")}</th>
              <th scope="col" className={TH_CLASS}>{t("status")}</th>
              {manage ? <th scope="col" className={TH_CLASS}>{t("actions")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td className={`${TD_CLASS} font-mono`}>{account.code}</td>
                <td className={TD_CLASS}>
                  {accountName(account, locale)}
                  {account.systemKey ? <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs dark:bg-stone-800">{t("system")}</span> : null}
                </td>
                <td className={TD_CLASS}>
                  {types(account.type)} · {subtypes(account.subtype)}
                </td>
                <td className={TD_CLASS}>{account.isActive ? t("active") : t("inactive")}</td>
                {manage ? (
                  <td className={TD_CLASS}>
                    <div className="flex flex-wrap items-start gap-2">
                      <Link
                        href={`${base}/${account.id}`}
                        aria-label={t("editNamed", { code: account.code })}
                        className={`rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}
                      >
                        {t("edit")}
                      </Link>
                      {account.systemKey ? null : (
                        <>
                          <ActionForm
                            action={setAccountActiveAction.bind(null, company.id, account.id, !account.isActive)}
                            label={account.isActive ? t("deactivate") : t("activate")}
                            ariaLabel={t(account.isActive ? "deactivateNamed" : "activateNamed", { code: account.code })}
                          />
                          <ActionForm action={deleteAccountAction.bind(null, company.id, account.id)} label={t("delete")} ariaLabel={t("deleteNamed", { code: account.code })} />
                        </>
                      )}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {manage ? <AccountForm companyId={company.id} /> : null}
    </section>
  );
}
