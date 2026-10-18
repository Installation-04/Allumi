import "server-only";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { getCompanyFor } from "@/modules/companies";
import type { Locale } from "@/modules/ledger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What every page of a company needs: the signed-in user, the company (the database only answers if the user is
 * a member), the user's role in it and the language. Anything else is a 404, whether the company exists or not.
 */
export async function loadCompany(params: Promise<{ companyId: string }>) {
  const { companyId } = await params;
  const session = await requireSession();
  if (!UUID.test(companyId)) notFound();
  const company = await getCompanyFor(session.userId, companyId);
  if (!company) notFound();
  const locale: Locale = (await getLocale()) === "en" ? "en" : "fr-CA";
  return { session, company, locale, actor: { userId: session.userId, companyId } };
}

/** The account name in the user's language. */
export function accountName(account: { nameFr: string; nameEn: string }, locale: Locale): string {
  return locale === "en" ? account.nameEn : account.nameFr;
}
