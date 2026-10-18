import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { listAccounts } from "@/modules/ledger";
import { listTaxCodes } from "@/modules/taxes";
import { loadCompany } from "../../_lib";
import { createItemAction } from "../actions";
import { ItemFields } from "../item-fields";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("items"))("newTitle") };
}

export default async function NewItemPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  if (!can(company.role, "item.manage")) notFound();
  const t = await getTranslations("items");
  const [accounts, taxCodes] = await Promise.all([listAccounts(actor), listTaxCodes(actor)]);
  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("newTitle")}</h1>
      <ActionForm action={createItemAction.bind(null, company.id)} label={t("create")} variant="primary">
        <ItemFields accounts={accounts} taxCodes={taxCodes} locale={locale} />
      </ActionForm>
      <Link href={`/c/${company.id}/produits`} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
        {t("back")}
      </Link>
    </section>
  );
}
