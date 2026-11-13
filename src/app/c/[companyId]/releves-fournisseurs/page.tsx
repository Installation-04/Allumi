import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { formatMoney, listFiscalYears, todayIso } from "@/modules/ledger";
import {
  getSupplierStatement,
  getSupplierStatementExport,
  listStatementSuppliers,
  type SupplierStatementRow,
} from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { searchText } from "@/app/_lib/search-params";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TH_CLASS, TD_CLASS } from "@/app/_components/table";
import { loadCompany } from "../_lib";
import { StatementPrint } from "../_statement-print";
import { statementFilters } from "./filters";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getTranslations("supplierStatement"))("title") };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  if (!can(company, "contact.read")) notFound();
  const t = await getTranslations("supplierStatement"),
    q = await searchParams;
  const filters = statementFilters(q, await listFiscalYears(actor), todayIso()),
    print = q.imprimer === "1";
  const rawPage = Number(searchText(q.page));
  const report = filters.contactId
    ? await (
        print
          ? getSupplierStatementExport(actor, {
              ...filters,
              contactId: filters.contactId,
            })
          : getSupplierStatement(actor, {
              ...filters,
              contactId: filters.contactId,
              page: rawPage,
            })
      ).catch((e) => {
        if (e instanceof AppError && e.key === "reports.contact") notFound();
        throw e;
      })
    : null;
  if (print && !report) notFound();
  const term = searchText(q.q, 120) ?? "",
    found = print
      ? { contacts: [], hasMore: false }
      : await listStatementSuppliers(actor, term);
  const contacts =
    report && !found.contacts.some((c) => c.id === report.contact.id)
      ? [report.contact, ...found.contacts]
      : found.contacts;
  const base = `/c/${company.id}`,
    path = `${base}/releves-fournisseurs`,
    query = new URLSearchParams({
      contact: filters.contactId ?? "",
      du: filters.from,
      au: filters.to,
    });
  const control = `min-h-11 min-w-0 max-w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const link = `inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`,
    money = (n: bigint) => formatMoney(n, locale);
  const source = (r: SupplierStatementRow) =>
    r.kind === "BILL"
      ? `${base}/achats/validees/${r.sourceId}`
      : r.kind === "SUPPLIER_CREDIT"
        ? `${base}/credits-fournisseurs/valides/${r.sourceId}`
        : r.kind === "PAYMENT"
          ? `${base}/decaissements/${r.sourceId}`
          : `${base}/journal/${r.entryId}`;
  return (
    <section
      className={`space-y-5 [overflow-wrap:anywhere] ${print ? "statement-print" : ""}`}
    >
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {!print && (
        <>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {t("intro")}
          </p>
          <details className="rounded border p-3">
            <summary className="min-h-11 cursor-pointer">
              {t("searchSuppliers")}
            </summary>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <input
                type="hidden"
                name="contact"
                value={filters.contactId ?? ""}
              />
              <input type="hidden" name="du" value={filters.from} />
              <input type="hidden" name="au" value={filters.to} />
              <label className="min-w-0">
                <span className="mb-1 block">{t("search")}</span>
                <input
                  name="q"
                  maxLength={120}
                  defaultValue={term}
                  className={control}
                />
              </label>
              <button className={link}>{t("find")}</button>
            </form>
            {found.hasMore && <p>{t("limit")}</p>}
          </details>
          <form
            key={query.toString() + term}
            method="get"
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="q" value={term} />
            <div className="min-w-0">
              <label htmlFor="statement-contact" className="mb-1 block">
                {t("supplier")}
              </label>
              <select
                id="statement-contact"
                name="contact"
                required
                defaultValue={filters.contactId ?? ""}
                className={control}
              >
                <option value="">{t("choose")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                    {c.isActive ? "" : ` · ${t("archived")}`}
                  </option>
                ))}
              </select>
            </div>
            <label>
              <span className="mb-1 block">{t("from")}</span>
              <input
                type="date"
                name="du"
                defaultValue={filters.from}
                required
                className={control}
              />
            </label>
            <label>
              <span className="mb-1 block">{t("to")}</span>
              <input
                type="date"
                name="au"
                defaultValue={filters.to}
                required
                className={control}
              />
            </label>
            <button className={link}>{t("apply")}</button>
          </form>
        </>
      )}
      {report ? (
        <>
          {print && <StatementPrint companyName={company.name} />}
          <h2 className="text-xl font-semibold">
            {report.contact.displayName}
          </h2>
          <p>{t("period", { from: report.from, to: report.to })} · CAD</p>
          <p className="text-sm">{t("rules")}</p>
          {!print && (
            <div className="flex flex-wrap gap-3">
              <a className={link} href={`${path}/export?${query}`}>
                {t("export")}
              </a>
              <Link className={link} href={`${path}?${query}&imprimer=1`}>
                {t("printView")}
              </Link>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(["opening", "debit", "credit", "closing"] as const).map((k) => (
              <div
                className="rounded border bg-white p-4 dark:bg-stone-900"
                key={k}
              >
                <dt className="text-sm">{t(k)}</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {money(report[`${k}Cents`])}
                </dd>
              </div>
            ))}
          </dl>
          <p role="status">{t("count", { count: report.lineCount })}</p>
          {!report.rows.length ? (
            <p>{t("empty")}</p>
          ) : (
            <>
              <div className={print ? "" : "hidden md:block"}>
                <table className={TABLE_CLASS}>
                  <thead>
                    <tr>
                      {(
                        [
                          "date",
                          "document",
                          "debit",
                          "credit",
                          "balance",
                        ] as const
                      ).map((k) => (
                        <th key={k} className={TH_CLASS}>
                          {t(k)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={r.id}>
                        <td className={TD_CLASS}>{r.date}</td>
                        <td className={TD_CLASS}>
                          {print ? (
                            <>
                              {t(`kinds.${r.kind}`)} {r.sourceNumber}{r.supplierReference ? ` · ${r.supplierReference}` : null}
                            </>
                          ) : (
                            <Link
                              className={`underline ${FOCUS}`}
                              href={source(r)}
                            >
                              {t(`kinds.${r.kind}`)}{" "}
                              {r.sourceNumber ?? r.entryNumber}{r.supplierReference ? ` · ${r.supplierReference}` : null}
                            </Link>
                          )}
                        </td>
                        <td className={`${TD_CLASS} text-right tabular-nums`}>
                          {money(r.debitCents)}
                        </td>
                        <td className={`${TD_CLASS} text-right tabular-nums`}>
                          {money(r.creditCents)}
                        </td>
                        <td className={`${TD_CLASS} text-right tabular-nums`}>
                          {money(r.balanceCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!print && (
                <ul className="space-y-3 md:hidden">
                  {report.rows.map((r) => (
                    <li
                      key={r.id}
                      className="rounded border bg-white p-4 dark:bg-stone-900"
                    >
                      <p>{r.date}</p>
                      <Link
                        className={`inline-flex min-h-11 min-w-0 max-w-full items-center underline ${FOCUS}`}
                        href={source(r)}
                      >
                        {t(`kinds.${r.kind}`)} {r.sourceNumber ?? r.entryNumber}{r.supplierReference ? ` · ${r.supplierReference}` : null}
                      </Link>
                      <dl className="grid grid-cols-2 gap-2">
                        {(["debit", "credit", "balance"] as const).map((k) => (
                          <div key={k}>
                            <dt className="text-sm">{t(k)}</dt>
                            <dd className="tabular-nums">
                              {money(r[`${k}Cents`])}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {!print && report.pageCount > 1 && (
            <nav aria-label={t("pagination")} className="flex flex-wrap gap-3">
              {report.page > 1 && (
                <Link
                  className={link}
                  href={`${path}?${query}&page=${report.page - 1}`}
                >
                  {t("previous")}
                </Link>
              )}
              <span>
                {t("page", { page: report.page, count: report.pageCount })}
              </span>
              {report.page < report.pageCount && (
                <Link
                  className={link}
                  href={`${path}?${query}&page=${report.page + 1}`}
                >
                  {t("next")}
                </Link>
              )}
            </nav>
          )}
        </>
      ) : (
        <p>{t("chooseHint")}</p>
      )}
    </section>
  );
}
