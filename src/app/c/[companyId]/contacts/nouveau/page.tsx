import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { ContactForm } from "../contact-form";

export async function generateMetadata() { return { title: (await getTranslations("contacts"))("new") }; }

export default async function NewContactPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company } = await loadCompany(params);
  if (!can(company, "contact.manage")) notFound();
  const t = await getTranslations("contacts");
  return <section className="max-w-3xl space-y-5"><Link href={`/c/${company.id}/contacts`} className={`inline-flex min-h-11 items-center rounded text-sm underline ${FOCUS}`}>{t("back")}</Link><h1 className="text-2xl font-semibold">{t("new")}</h1><ContactForm companyId={company.id} /></section>;
}
