import { notFound } from "next/navigation";
import { can } from "@/modules/companies";
import { resolveLedgerContact } from "../_ledger-contact";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { statementPeriod } from "@/app/_lib/report-period";
import { searchText } from "@/app/_lib/search-params";
import { formatMoney, listAccounts, listFiscalYears, todayIso } from "@/modules/ledger";
import { getAccountLedger,listLedgerContacts } from "@/modules/reports";
import { accountName, loadCompany } from "../_lib";
import { validId } from "../factures/editor";

export const dynamic = "force-dynamic";

export async function generateMetadata() { return { title: (await getTranslations("ledgerReport"))("title") }; }

export default async function GeneralLedgerPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const t = await getTranslations("ledgerReport");
  const query = await searchParams;
  const [accounts, years] = [await listAccounts(actor), await listFiscalYears(actor)];
  const { from, to } = statementPeriod(query, years, todayIso());
  const rawAccount = searchText(query.compte);
  const accountId = rawAccount && validId(rawAccount) ? rawAccount : undefined;
  const mayFilter=can(company,"contact.read");
  if(!mayFilter&&searchText(query.contact))notFound();
  const contact=await resolveLedgerContact(actor,query.contact);
  const contactQuery=(searchText(query.q_contact)??"").trim().slice(0,120);
  const found=mayFilter?await listLedgerContacts(actor,contactQuery):{contacts:[],hasMore:false};
  const contacts=contact&&!found.contacts.some(c=>c.id===contact.id)?[contact,...found.contacts]:found.contacts;
  const contactParams:Record<string,string>=contact?{contact:contact.id}:{};
  const rawPage = Number(searchText(query.page));
  const ledger = accountId && accounts.some((account) => account.id === accountId)
    ? await getAccountLedger(actor, { accountId, from, to, contactId:contact?.id, page: Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100_000 ? rawPage : 1 })
    : null;
  const base = `/c/${company.id}/grand-livre`;
  const control = `min-h-11 rounded-md border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const button = `inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`;
  const link = `inline-flex min-h-11 items-center rounded px-3 text-sm underline ${FOCUS}`;
  const page = (number: number) => `${base}?${new URLSearchParams({ compte: accountId ?? "", du: from, au: to,...contactParams,q_contact:contactQuery, page: String(number) })}`;
  const money = (cents: bigint) => formatMoney(cents, locale);
  const amount = "text-right tabular-nums";
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
      </div>
      {mayFilter&&<details className="rounded border border-stone-300 p-3 dark:border-stone-700">
        <summary className={`inline-flex min-h-11 cursor-pointer items-center rounded text-sm underline ${FOCUS}`}>{t("searchContacts")}</summary>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="compte" value={accountId??""}/><input type="hidden" name="du" value={from}/><input type="hidden" name="au" value={to}/><input type="hidden" name="contact" value={contact?.id??""}/>
          <label className="min-w-0 text-sm"><span className="mb-1 block">{t("contactSearch")}</span><input name="q_contact" maxLength={120} defaultValue={contactQuery} className={`${control} max-w-full`}/></label><button className={button}>{t("search")}</button>
        </form><p className="text-sm">{t("searchHint")}</p>
      </details>}
      {mayFilter&&contactQuery&&<p className="text-sm">{t("searchResults",{query:contactQuery})}</p>}
      {found.hasMore&&<p className="text-sm">{t("contactLimit")}</p>}
      <form key={`${from}|${to}|${accountId ?? ""}|${contact?.id??""}|${contactQuery}`} method="get" className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">{t("account")}</span>
          <select name="compte" defaultValue={accountId ?? ""} className={`${control} max-w-full`}>
            <option value="">{t("chooseAccount")}</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} – {accountName(account, locale)}</option>)}
          </select></label>
        <input type="hidden" name="q_contact" value={contactQuery}/>
        {mayFilter&&<div className="min-w-0 text-sm"><label htmlFor="ledger-contact" className="mb-1 block font-medium">{t("contactFilter")}</label><select id="ledger-contact" name="contact" defaultValue={contact?.id??""} className={`${control} max-w-full`}><option value="">{t("allContacts")}</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.displayName}{c.isActive?"":` · ${t("inactiveContact")}`}</option>)}</select></div>}
        <label className="text-sm"><span className="mb-1 block font-medium">{t("from")}</span><input type="date" name="du" defaultValue={from} required className={control} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">{t("to")}</span><input type="date" name="au" defaultValue={to} required className={control} /></label>
        <button type="submit" className={button}>{t("apply")}</button>
        {ledger ? <a href={`${base}/export?${new URLSearchParams({ compte: ledger.account.id, du: from, au: to,...contactParams })}`} className={button}>{t("exportAccount")}</a> : null}
        <a href={`${base}/export?${new URLSearchParams({ du: from, au: to,...contactParams })}`} className={button}>{t("exportAll")}</a>
      </form>
      {contact&&<p role="status" className="rounded border border-stone-300 p-3 text-sm dark:border-stone-700">{t("filtered",{contact:contact.displayName})}</p>}
      {years.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-1 text-sm">
          <span>{t("fiscalYears")}</span>
          {years.map((year) => <Link key={year.id} href={`${base}?${new URLSearchParams({ compte: accountId ?? "", du: year.start, au: year.end,...contactParams,q_contact:contactQuery })}`} className={link}>{year.start} → {year.end}</Link>)}
        </p>
      ) : null}
      {ledger === null ? <p className="text-sm">{t("pickAccount")}</p> : (
        <>
          <h2 className="text-lg font-semibold break-words">{ledger.account.code} – {accountName(ledger.account, locale)}</h2>
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt>{t("opening")}</dt><dd className="text-right">{money(ledger.openingCents)}</dd>
            <dt>{t("debits")}</dt><dd className="text-right">{money(ledger.debitCents)}</dd>
            <dt>{t("credits")}</dt><dd className="text-right">{money(ledger.creditCents)}</dd>
            <dt className="font-medium">{t("closing")}</dt><dd className="text-right font-medium">{money(ledger.closingCents)}</dd>
          </dl>
          <p className="text-sm" role="status">{t("count", { count: ledger.lineCount })}</p>
          {ledger.lineCount === 0 ? <p>{t("empty")}</p> : (
            <div className="overflow-x-auto">
              <table className={TABLE_CLASS}>
                <caption className="sr-only">{t("title")} · {ledger.account.code} · {from} → {to}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH_CLASS}>{t("date")}</th>
                    <th scope="col" className={TH_CLASS}>{t("entry")}</th>
                    <th scope="col" className={TH_CLASS}>{t("description")}</th>
                    <th scope="col" className={`${TH_CLASS} text-right`}>{t("debit")}</th>
                    <th scope="col" className={`${TH_CLASS} text-right`}>{t("credit")}</th>
                    <th scope="col" className={`${TH_CLASS} text-right`}>{t("balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.page === 1 ? (
                    <tr><th scope="row" colSpan={5} className={`${TD_CLASS} text-left font-medium`}>{t("opening")}</th><td className={`${TD_CLASS} ${amount}`}>{money(ledger.openingCents)}</td></tr>
                  ) : null}
                  {ledger.rows.map((row) => (
                    <tr key={row.lineId}>
                      <td className={`${TD_CLASS} whitespace-nowrap`}>{row.date}</td>
                      <td className={TD_CLASS}><Link href={`/c/${company.id}/journal/${row.entryId}`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{row.entryLabel}</Link></td>
                      <td className={`${TD_CLASS} break-words`}>
                        {row.memo || row.description}{row.contactName ? ` · ${row.contactName}` : ""}{row.reversed ? ` · ${t("reversed")}` : ""}
                      </td>
                      <td className={`${TD_CLASS} ${amount}`}>{row.debitCents > 0n ? money(row.debitCents) : ""}</td>
                      <td className={`${TD_CLASS} ${amount}`}>{row.creditCents > 0n ? money(row.creditCents) : ""}</td>
                      <td className={`${TD_CLASS} ${amount}`}>{money(row.balanceCents)}</td>
                    </tr>
                  ))}
                  {ledger.page === ledger.pageCount ? (
                    <tr><th scope="row" colSpan={5} className={`${TD_CLASS} text-left font-semibold`}>{t("closing")}</th><td className={`${TD_CLASS} ${amount} font-semibold`}>{money(ledger.closingCents)}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
          {ledger.pageCount > 1 ? (
            <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">
              {ledger.page > 1 ? <Link href={page(ledger.page - 1)} className={link}>{t("previous")}</Link> : null}
              <span className="text-sm">{t("page", { page: ledger.page, count: ledger.pageCount })}</span>
              {ledger.page < ledger.pageCount ? <Link href={page(ledger.page + 1)} className={link}>{t("next")}</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
