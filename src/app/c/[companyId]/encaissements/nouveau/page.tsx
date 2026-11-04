import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getContact, listContacts } from "@/modules/contacts";
import { todayIso } from "@/modules/ledger";
import { listReceiptAccounts, PAYMENT_METHODS } from "@/modules/payments";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { validId } from "../../factures/editor";
import { recordOnAccountReceiptAction } from "../on-account-actions";

export async function generateMetadata() { return { title: (await getTranslations("onAccountReceipts"))("title") }; }

export default async function NewOnAccountReceiptPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "sales.manage");
  if (!can(company, "sales.read") || !can(company, "ledger.read") || !can(company, "entry.post") || !can(company, "contact.read")) notFound();
  const query = await searchParams;
  if ([query.q, query.page, query.client].some(Array.isArray)) notFound();
  const rawSearch = query.q as string | undefined;
  if (rawSearch && /[\u0000-\u001f\u007f]/.test(rawSearch)) notFound();
  const search = rawSearch?.trim() ?? "";
  const pageText = (query.page as string | undefined) ?? "1";
  const contactId = (query.client as string | undefined) ?? "";
  if (search.length > 100 || !/^[1-9]\d{0,4}$/.test(pageText) || (contactId && !validId(contactId))) notFound();
  const result = await listContacts(actor, { q: search, kind: "CUSTOMER", status: "ACTIVE", page: Number(pageText) });
  const contact = contactId ? await getContact(actor, contactId) : null;
  if (contactId && (!contact || !contact.isActive || !contact.isCustomer)) notFound();
  const accounts = contact ? await listReceiptAccounts(actor) : [];
  const t = await getTranslations("onAccountReceipts");
  const payments = await getTranslations("payments");
  const base = `/c/${company.id}/encaissements/nouveau`;
  const paramsFor = (page: number, client?: string) => `${base}?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page), ...(client ? { client } : {}) })}`;
  const fieldClass = `min-h-11 w-full min-w-0 rounded border border-stone-300 bg-white px-3 text-base dark:border-stone-600 dark:bg-stone-950 ${FOCUS}`;
  const buttonClass = `inline-flex min-h-11 items-center justify-center rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-700 ${FOCUS}`;
  return <section className="max-w-3xl space-y-5 break-words">
    <Link href={`/c/${company.id}/encaissements`} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{payments("back")}</Link>
    <h1 className="text-2xl font-semibold">{t("title")}</h1>
    <p className="text-sm">{t("intro")}</p>
    <section className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="receipt-customer-title">
      <h2 id="receipt-customer-title" className="font-semibold">{t("chooseCustomer")}</h2>
      <form action={base} method="get" className="space-y-2">
        <label htmlFor="on-account-customer-search" className="block text-sm font-medium">{t("search")}</label>
        <div className="flex flex-wrap gap-2"><input id="on-account-customer-search" name="q" type="search" maxLength={100} defaultValue={search} className={`${fieldClass} flex-1 basis-48`} /><button className={buttonClass} type="submit">{t("searchAction")}</button></div>
      </form>
      {!result.contacts.length ? <p>{t("noCustomers")}</p> : <ul className="divide-y divide-stone-200 dark:divide-stone-700">{result.contacts.map(customer => <li key={customer.id}><Link href={paramsFor(result.page, customer.id)} aria-current={contact?.id === customer.id ? "true" : undefined} className={`flex min-h-11 items-center rounded py-2 underline ${FOCUS}`}>{customer.displayName}</Link></li>)}</ul>}
      {result.pageCount > 1 && <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">
        {result.page > 1 && <Link href={paramsFor(result.page - 1)} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("previous")}</Link>}
        <span>{t("page", { page: result.page, count: result.pageCount })}</span>
        {result.page < result.pageCount && <Link href={paramsFor(result.page + 1)} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("next")}</Link>}
      </nav>}
    </section>
    {contact && <section className="space-y-3 rounded border border-green-700 p-4 dark:border-green-500" aria-labelledby="on-account-review-title">
      <h2 id="on-account-review-title" className="font-semibold">{t("selected", { customer: contact.displayName })}</h2>
      <p className="text-sm">{t("recordHint")}</p>
      <ActionForm action={recordOnAccountReceiptAction.bind(null, company.id, contact.id, randomUUID())} label={t("submit")}>
        <Field name="amount" label={payments("amountField")} inputMode="decimal" autoComplete="off" />
        <Field name="date" label={payments("dateField")} type="date" defaultValue={todayIso()} />
        <SelectField name="accountId" label={payments("accountField")} hint={payments("accountHint")} options={accounts.map(account => ({ value: account.id, label: `${account.code} · ${accountName(account, locale)}` }))} />
        <SelectField name="method" label={payments("methodField")} options={PAYMENT_METHODS.map(value => ({ value, label: payments(`methods.${value}`) }))} defaultValue="EFT" />
        <Field name="reference" label={payments("referenceField")} required={false} autoComplete="off" />
        <Field name="memo" label={payments("memoField")} required={false} autoComplete="off" />
        <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label>
      </ActionForm>
    </section>}
  </section>;
}
