import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getContact } from "@/modules/contacts";
import { can } from "@/modules/companies";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { ContactForm } from "../contact-form";
import { setContactActiveAction } from "../actions";

export async function generateMetadata() { return { title: (await getTranslations("contacts"))("details") }; }

export default async function ContactPage({ params }: { params: Promise<{ companyId: string; contactId: string }> }) {
  const { company, actor } = await loadCompany(params);
  const { contactId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId)) notFound();
  const contact = await getContact(actor, contactId);
  if (!contact) notFound();
  const t = await getTranslations("contacts");
  const initial = Object.fromEntries(Object.entries(contact).map(([key, value]) => [key, value == null ? "" : String(value)]));
  initial.kind = contact.isCustomer ? (contact.isSupplier ? "BOTH" : "CUSTOMER") : "SUPPLIER";
  return (
    <section className="max-w-3xl space-y-5 break-words">
      <Link href={`/c/${company.id}/contacts`} className={`inline-flex min-h-11 items-center rounded text-sm underline ${FOCUS}`}>{t("back")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{contact.displayName}</h1><span className="rounded-full bg-stone-200 px-3 py-1 text-sm dark:bg-stone-800">{contact.isActive ? t("active") : t("archived")}</span></div>
      {can(company.role, "contact.manage") ? <>
        <ContactForm companyId={company.id} contactId={contact.id} initial={initial} />
        <div className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800"><p className="text-sm">{t("archiveHint")}</p><ActionForm action={setContactActiveAction.bind(null, company.id, contact.id, !contact.isActive)} label={contact.isActive ? t("archive") : t("restore")} /></div>
      </> : <dl className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:grid-cols-2">
        <div><dt className="text-sm text-stone-500">{t("locale")}</dt><dd>{contact.locale === "en" ? "English" : "Français"}</dd></div>
        <div><dt className="text-sm text-stone-500">{t("kind")}</dt><dd>{t(`kinds.${initial.kind as "CUSTOMER" | "SUPPLIER" | "BOTH"}`)}</dd></div>
        {(["legalName", "email", "phone", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "paymentTermsDays", "notes"] as const).map((field) => <div key={field}><dt className="text-sm text-stone-500">{t(field)}</dt><dd className="whitespace-pre-wrap">{initial[field] || "—"}</dd></div>)}
      </dl>}
    </section>
  );
}
