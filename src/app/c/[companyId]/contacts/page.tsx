import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listContacts, type ContactFilter } from "@/modules/contacts";
import { searchText } from "@/app/_lib/search-params";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TH_CLASS, TD_CLASS } from "@/app/_components/table";
import { loadCompany } from "../_lib";

export async function generateMetadata() { return { title: (await getTranslations("contacts"))("title") }; }

export default async function ContactsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor } = await loadCompany(params);
  const query = await searchParams;
  const q = searchText(query.q, 100) ?? "";
  const rawKind = searchText(query.kind);
  const kind: ContactFilter["kind"] = rawKind === "CUSTOMER" || rawKind === "SUPPLIER" ? rawKind : "ALL";
  const rawStatus = searchText(query.status);
  const status: ContactFilter["status"] = rawStatus === "ARCHIVED" || rawStatus === "ALL" ? rawStatus : "ACTIVE";
  const rawPage = Number(searchText(query.page));
  const result = await listContacts(actor, { q, kind, status, page: Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1 });
  const t = await getTranslations("contacts");
  const base = `/c/${company.id}/contacts`;
  const url = (change: Partial<ContactFilter>) => `${base}?${new URLSearchParams({ q, kind, status, page: String(result.page), ...Object.fromEntries(Object.entries(change).map(([k, v]) => [k, String(v)])) })}`;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-stone-500">{t("intro")}</p></div>{can(company.role, "contact.manage") && <Link href={`${base}/nouveau`} className={`inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 ${FOCUS}`}>{t("new")}</Link>}</div>
      <nav aria-label={t("typesLabel")} className="flex gap-4 border-b border-stone-200 dark:border-stone-800">
        {(["ALL", "CUSTOMER", "SUPPLIER"] as const).map((value) => <Link key={value} href={url({ kind: value, page: 1 })} aria-current={kind === value ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 px-1 text-sm ${FOCUS} ${kind === value ? "border-brand-700 font-semibold" : "border-transparent"}`}>{t(`filters.${value}`)}</Link>)}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="kind" value={kind} />
        <label className="min-w-0 flex-1 text-sm"><span className="mb-1 block">{t("search")}</span><input key={q} type="search" name="q" maxLength={100} defaultValue={q} className={`min-h-11 w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} /></label>
        <label className="text-sm"><span className="mb-1 block">{t("status")}</span><select key={status} name="status" defaultValue={status} className={`min-h-11 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>{(["ACTIVE", "ARCHIVED", "ALL"] as const).map((value) => <option key={value} value={value}>{t(`statuses.${value}`)}</option>)}</select></label>
        <button className={`min-h-11 rounded border border-stone-300 px-4 text-sm dark:border-stone-700 ${FOCUS}`}>{t("apply")}</button>
      </form>
      <p className="text-sm text-stone-500" role="status">{t("count", { count: result.total })}</p>
      {result.contacts.length === 0 ? <div className="border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-700 dark:bg-stone-900"><h2 className="font-semibold">{t("empty")}</h2><p className="mt-2 text-sm text-stone-500">{t("emptyHint")}</p></div> : <>
        <div className="hidden overflow-x-auto lg:block"><table className={TABLE_CLASS}><caption className="sr-only">{t("title")}</caption><thead><tr>{(["displayName", "kind", "email", "phone", "status"] as const).map((key) => <th scope="col" key={key} className={TH_CLASS}>{t(key)}</th>)}</tr></thead><tbody>
          {result.contacts.map((contact) => <tr key={contact.id}><td className={TD_CLASS}><Link href={`${base}/${contact.id}`} className={`inline-flex min-h-11 items-center rounded font-semibold text-brand-700 dark:text-brand-500 ${FOCUS}`}>{contact.displayName}</Link>{contact.legalName && <p className="text-xs text-stone-500">{contact.legalName}</p>}</td><td className={TD_CLASS}>{t(`kinds.${contact.isCustomer ? contact.isSupplier ? "BOTH" : "CUSTOMER" : "SUPPLIER"}`)}</td><td className={TD_CLASS}>{contact.email || "—"}</td><td className={TD_CLASS}>{contact.phone || "—"}</td><td className={TD_CLASS}>{contact.isActive ? t("active") : t("archived")}</td></tr>)}
        </tbody></table></div>
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900 lg:hidden">{result.contacts.map((contact) => <li key={contact.id}><Link href={`${base}/${contact.id}`} className={`block min-h-11 break-words rounded p-4 ${FOCUS}`}><span className="block font-semibold text-brand-700 dark:text-brand-500">{contact.displayName}</span><span className="mt-1 block text-xs text-stone-500">{t(`kinds.${contact.isCustomer ? contact.isSupplier ? "BOTH" : "CUSTOMER" : "SUPPLIER"}`)} · {contact.isActive ? t("active") : t("archived")}</span>{contact.email && <span className="mt-2 block text-sm">{contact.email}</span>}{contact.phone && <span className="block text-sm">{contact.phone}</span>}</Link></li>)}</ul>
      </>}
      <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-4 text-sm">{result.page > 1 && <Link className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`} href={url({ page: result.page - 1 })}>{t("previous")}</Link>}<span>{t("page", { page: result.page, count: result.pageCount })}</span>{result.page < result.pageCount && <Link className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`} href={url({ page: result.page + 1 })}>{t("next")}</Link>}</nav>
    </section>
  );
}
