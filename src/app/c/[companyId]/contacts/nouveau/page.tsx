import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { listTaxCodes } from "@/modules/taxes";
import { loadCompany } from "../../_lib";
import { createContactAction } from "../actions";
import { ContactFields } from "../contact-fields";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("contacts"))("newTitle") };
}

export default async function NewContactPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  if (!can(company.role, "contact.manage")) notFound();
  const t = await getTranslations("contacts");
  const taxCodes = await listTaxCodes(actor);
  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("newTitle")}</h1>
      <ActionForm action={createContactAction.bind(null, company.id)} label={t("create")} variant="primary">
        <ContactFields taxCodes={taxCodes} locale={locale} />
      </ActionForm>
      <Link href={`/c/${company.id}/contacts`} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
        {t("back")}
      </Link>
    </section>
  );
}
