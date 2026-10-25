import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm, Field } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { getAccount } from "@/modules/ledger";
import { loadCompany } from "../../_lib";
import { updateAccountAction } from "../actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata() {
  return { title: (await getTranslations("accounts"))("title") };
}

export default async function EditAccountPage({ params }: { params: Promise<{ companyId: string; accountId: string }> }) {
  const { accountId } = await params;
  const { company, actor } = await loadCompany(params);
  if (!UUID.test(accountId) || !can(company, "account.manage")) notFound();
  const account = await getAccount(actor, accountId);
  if (!account) notFound();
  const t = await getTranslations("accounts");

  return (
    <section className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("editTitle", { code: account.code })}</h1>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("typeFrozen")}</p>
      <ActionForm action={updateAccountAction.bind(null, company.id, account.id)} label={t("save")} variant="primary">
        <Field name="code" label={t("code")} hint={t("codeHint")} defaultValue={account.code} autoComplete="off" />
        <Field name="nameFr" label={t("nameFr")} defaultValue={account.nameFr} autoComplete="off" />
        <Field name="nameEn" label={t("nameEn")} defaultValue={account.nameEn} autoComplete="off" />
        <Field name="description" label={t("description")} defaultValue={account.description ?? ""} required={false} />
      </ActionForm>
      <Link href={`/c/${company.id}/comptes`} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
        {t("backToList")}
      </Link>
    </section>
  );
}
