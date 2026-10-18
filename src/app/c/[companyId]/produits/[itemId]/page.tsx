import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { getItem } from "@/modules/contacts";
import { listAccounts } from "@/modules/ledger";
import { listTaxCodes } from "@/modules/taxes";
import { loadCompany } from "../../_lib";
import { deleteItemAction, setItemActiveAction, updateItemAction } from "../actions";
import { ItemFields } from "../item-fields";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata() {
  return { title: (await getTranslations("items"))("title") };
}

export default async function ItemPage({ params }: { params: Promise<{ companyId: string; itemId: string }> }) {
  const { itemId } = await params;
  const { company, actor, locale } = await loadCompany(params);
  if (!UUID.test(itemId)) notFound();
  const item = await getItem(actor, itemId);
  if (!item) notFound();
  const t = await getTranslations("items");
  const manage = can(company.role, "item.manage");
  const [accounts, taxCodes] = await Promise.all([listAccounts(actor, { includeInactive: true }), listTaxCodes(actor)]);
  return (
    <section className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{item.name}</h1>
        <p className="text-sm">{item.isActive ? t("active") : t("inactive")}</p>
      </div>
      {manage ? (
        <>
          <ActionForm action={updateItemAction.bind(null, company.id, item.id)} label={t("save")} variant="primary">
            <ItemFields item={item} accounts={accounts} taxCodes={taxCodes} locale={locale} />
          </ActionForm>
          <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <h2 className="text-lg font-semibold">{t("manageTitle")}</h2>
            <div className="flex flex-wrap items-start gap-4">
              <ActionForm action={setItemActiveAction.bind(null, company.id, item.id, !item.isActive)} label={item.isActive ? t("deactivate") : t("activate")} />
              <ActionForm action={deleteItemAction.bind(null, company.id, item.id)} label={t("delete")} />
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">{t("deleteHint")}</p>
          </div>
        </>
      ) : (
        <p className="text-sm">{t("readOnly")}</p>
      )}
      <Link href={`/c/${company.id}/produits`} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
        {t("back")}
      </Link>
    </section>
  );
}
