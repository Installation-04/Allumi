import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm, CheckboxField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { getContact } from "@/modules/contacts";
import { listTaxCodes } from "@/modules/taxes";
import { loadCompany } from "../../_lib";
import { anonymizeContactAction, deleteContactAction, setContactActiveAction, updateContactAction } from "../actions";
import { ContactFields } from "../contact-fields";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata() {
  return { title: (await getTranslations("contacts"))("title") };
}

export default async function ContactPage({ params }: { params: Promise<{ companyId: string; contactId: string }> }) {
  const { contactId } = await params;
  const { company, actor, locale } = await loadCompany(params);
  if (!UUID.test(contactId)) notFound();
  const contact = await getContact(actor, contactId);
  if (!contact) notFound();
  const t = await getTranslations("contacts");
  const manage = can(company.role, "contact.manage") && !contact.anonymized;
  const taxCodes = await listTaxCodes(actor);
  const back = (
    <Link href={`/c/${company.id}/contacts`} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
      {t("back")}
    </Link>
  );

  if (contact.anonymized) {
    return (
      <section className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">{contact.displayName}</h1>
        <p>{t("anonymizedNote")}</p>
        {back}
      </section>
    );
  }

  return (
    <section className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{contact.displayName}</h1>
        <p className="text-sm">{contact.isActive ? t("active") : t("inactive")}</p>
      </div>

      {manage ? (
        <ActionForm action={updateContactAction.bind(null, company.id, contact.id)} label={t("save")} variant="primary">
          <ContactFields contact={contact} taxCodes={taxCodes} locale={locale} />
        </ActionForm>
      ) : (
        <p className="text-sm">{t("readOnly")}</p>
      )}

      {manage ? (
        <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="text-lg font-semibold">{t("manageTitle")}</h2>
          <div className="flex flex-wrap items-start gap-4">
            <ActionForm action={setContactActiveAction.bind(null, company.id, contact.id, !contact.isActive)} label={contact.isActive ? t("deactivate") : t("activate")} />
            <ActionForm action={deleteContactAction.bind(null, company.id, contact.id)} label={t("delete")} />
          </div>
          <p className="text-xs text-stone-600 dark:text-stone-400">{t("deleteHint")}</p>
        </div>
      ) : null}

      {can(company.role, "contact.anonymize") ? (
        <div className="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <h2 className="text-lg font-semibold">{t("anonymizeTitle")}</h2>
          <p className="text-sm">{t("anonymizeIntro")}</p>
          <ActionForm action={anonymizeContactAction.bind(null, company.id, contact.id)} label={t("anonymize")}>
            <CheckboxField name="confirm" label={t("anonymizeConfirm")} required />
          </ActionForm>
        </div>
      ) : null}
      {back}
    </section>
  );
}
