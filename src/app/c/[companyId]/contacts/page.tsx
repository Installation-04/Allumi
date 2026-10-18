import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { searchText } from "@/app/_lib/search-params";
import { can } from "@/modules/companies";
import { CONTACT_FILTERS, listContacts, type ContactFilter } from "@/modules/contacts";
import { loadCompany } from "../_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("contacts"))("title") };
}

type Search = { q?: string | string[]; type?: string | string[]; inactifs?: string | string[]; page?: string | string[] };

export default async function ContactsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Search> }) {
  const { company, actor } = await loadCompany(params);
  const search = await searchParams;
  const q = searchText(search.q);
  const typeText = searchText(search.type, 12);
  const filter: ContactFilter = (CONTACT_FILTERS as readonly string[]).includes(typeText ?? "") ? (typeText as ContactFilter) : "all";
  const includeInactive = searchText(search.inactifs, 1) === "1";
  const pageNumber = Number(searchText(search.page, 6) ?? "1");
  const t = await getTranslations("contacts");
  const result = await listContacts(actor, { search: q, filter, includeInactive, page: Number.isFinite(pageNumber) ? pageNumber : 1 });
  const base = `/c/${company.id}/contacts`;
  const query = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = { q, type: filter === "all" ? undefined : filter, inactifs: includeInactive ? "1" : undefined, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {can(company.role, "contact.manage") ? (
          <Link href={`${base}/nouveau`} className={`rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 ${FOCUS}`}>
            {t("new")}
          </Link>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("search")}</span>
          <input name="q" defaultValue={q} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("filterType")}</span>
          <select name="type" defaultValue={filter} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>
            <option value="all">{t("filterAll")}</option>
            <option value="customers">{t("filterCustomers")}</option>
            <option value="suppliers">{t("filterSuppliers")}</option>
          </select>
        </label>
        {includeInactive ? <input type="hidden" name="inactifs" value="1" /> : null}
        <button type="submit" className={`rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>
          {t("apply")}
        </button>
        <Link href={query({ inactifs: includeInactive ? undefined : "1", page: undefined })} className={`rounded-sm text-sm underline ${FOCUS}`}>
          {includeInactive ? t("hideInactive") : t("showInactive")}
        </Link>
      </form>

      {result.contacts.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <caption className="sr-only">{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH_CLASS}>{t("displayName")}</th>
                <th scope="col" className={TH_CLASS}>{t("roles")}</th>
                <th scope="col" className={TH_CLASS}>{t("email")}</th>
                <th scope="col" className={TH_CLASS}>{t("phone")}</th>
                <th scope="col" className={TH_CLASS}>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {result.contacts.map((contact) => (
                <tr key={contact.id}>
                  <td className={TD_CLASS}>
                    <Link href={`${base}/${contact.id}`} className={`rounded-sm font-medium underline ${FOCUS}`}>
                      {contact.displayName}
                    </Link>
                  </td>
                  <td className={TD_CLASS}>{[contact.isCustomer ? t("customer") : null, contact.isSupplier ? t("supplier") : null].filter(Boolean).join(" · ")}</td>
                  <td className={TD_CLASS}>{contact.email ?? "—"}</td>
                  <td className={TD_CLASS}>{contact.phone ?? "—"}</td>
                  <td className={TD_CLASS}>{contact.anonymized ? t("anonymized") : contact.isActive ? t("active") : t("inactive")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label={t("pages")} className="flex items-center gap-4 text-sm">
        <span>{t("pageOf", { page: result.page, count: result.pageCount, total: result.total })}</span>
        {result.page > 1 ? (
          <Link href={query({ page: String(result.page - 1) })} className={`rounded-sm underline ${FOCUS}`}>
            {t("previous")}
          </Link>
        ) : null}
        {result.page < result.pageCount ? (
          <Link href={query({ page: String(result.page + 1) })} className={`rounded-sm underline ${FOCUS}`}>
            {t("next")}
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
